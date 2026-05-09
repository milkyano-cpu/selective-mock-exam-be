import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const fileTypeFromBufferMock = jest.fn();
const sharpToBufferMock = jest.fn();
const sharpJpegMock = jest.fn(() => ({ toBuffer: sharpToBufferMock }));
const sharpPngMock = jest.fn(() => ({ toBuffer: sharpToBufferMock }));
const sharpWebpMock = jest.fn(() => ({ toBuffer: sharpToBufferMock }));
const sharpRotateMock = jest.fn(() => ({
  jpeg: sharpJpegMock,
  png: sharpPngMock,
  webp: sharpWebpMock,
}));
const sharpMock = jest.fn(() => ({ rotate: sharpRotateMock }));
const enqueueProfilePhotoCleanupMock = jest.fn();

jest.unstable_mockModule("file-type", () => ({
  fileTypeFromBuffer: fileTypeFromBufferMock,
}));
jest.unstable_mockModule("sharp", () => ({
  default: sharpMock,
}));
jest.unstable_mockModule("../../src/modules/users/profile-photo-cleanup.js", () => ({
  enqueueProfilePhotoCleanup: enqueueProfilePhotoCleanupMock,
}));

const { checkDbConnection } = await import("../../src/modules/health/health.service.js");
const {
  getMyProfile,
  getMyProfilePhotoAccess,
  getUserById,
  uploadMyProfilePhoto,
} = await import("../../src/modules/users/users.service.js");
const { encryptUserFields } = await import("../../src/utils/user-crypto.js");

function encryptedUser(email: string, fullName: string, overrides: Record<string, unknown> = {}) {
  const { fullNameTokens: _fullNameTokens, ...fields } = encryptUserFields({ email, fullName });
  return {
    ...fields,
    ...overrides,
  };
}

function mockRedis() {
  return {
    set: jest.fn(async () => "OK"),
    eval: jest.fn(async () => 1),
  };
}

function mockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe("service helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileTypeFromBufferMock.mockResolvedValue({ mime: "image/webp", ext: "webp" } as never);
    sharpToBufferMock.mockResolvedValue(Buffer.alloc(2048, 1) as never);
  });

  it("reports connected database status", async () => {
    const prisma = { $queryRaw: jest.fn(async () => [{ "?column?": 1 }]) };

    await expect(checkDbConnection(prisma as never)).resolves.toBe("connected");
  });

  it("reports disconnected database status", async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => {
        throw new Error("DB down");
      }),
    };

    await expect(checkDbConnection(prisma as never)).resolves.toBe("disconnected");
  });

  it("returns current user profile", async () => {
    const user = {
      ...encryptedUser("user@example.com", "Jane Doe"),
      id: "user-1",
      role: "PARENT",
      status: "ACTIVE",
      tier: "BASIC",
      profilePhotoKey: "profile-photos/parent/user-1/avatar.png",
      profilePhotoUpdatedAt: new Date("2026-04-25T00:00:00.000Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
      subscriptions: [],
    };
    const findUnique = jest.fn(async (..._args: unknown[]) => user);
    const prisma = { user: { findUnique } };

    await expect(getMyProfile(prisma as never, "user-1")).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
      fullName: "Jane Doe",
      role: "PARENT",
      status: "ACTIVE",
      tier: "BASIC",
      profilePhotoUpdatedAt: new Date("2026-04-25T00:00:00.000Z"),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      subscriptions: [],
      hasProfilePhoto: true,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        id: true,
        email: true,
        emailEncrypted: true,
        fullName: true,
        role: true,
        status: true,
        tier: true,
        profilePhotoKey: true,
        profilePhotoUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
        subscriptions: {
          select: { status: true, currentPeriodEnd: true },
          orderBy: { currentPeriodEnd: "desc" },
          take: 1,
        },
      },
    });
  });

  it("rejects missing current user profile", async () => {
    const prisma = { user: { findUnique: jest.fn(async () => null) } };

    await expect(getMyProfile(prisma as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns users by id", async () => {
    const user = {
      ...encryptedUser("user@example.com", "Jane Doe"),
      id: "user-1",
      role: "PARENT",
      status: "ACTIVE",
      createdAt: new Date(),
    };
    const prisma = { user: { findUnique: jest.fn(async () => user) } };

    await expect(getUserById(prisma as never, "user-1")).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
      fullName: "Jane Doe",
      role: "PARENT",
      status: "ACTIVE",
      createdAt: user.createdAt,
    });
  });

  it("returns signed access data for an existing current user profile photo", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async (..._args: unknown[]) => ({
          id: "user-1",
          profilePhotoKey: "profile-photos/parent/user-1/avatar.png",
          profilePhotoOriginalName: "avatar.png",
          profilePhotoMimeType: "image/png",
          profilePhotoSize: 1024,
          profilePhotoUpdatedAt: new Date("2026-04-25T00:00:00.000Z"),
        })),
      },
    };
    const storage = {
      signedUrlExpiresInSeconds: 900,
      getProfilePhotoSignedUrl: jest.fn(async (..._args: unknown[]) => "https://signed.example.com/avatar"),
    };

    await expect(
      getMyProfilePhotoAccess(prisma as never, storage as never, "user-1")
    ).resolves.toEqual({
      signedUrl: "https://signed.example.com/avatar",
      originalName: "avatar.png",
      mimeType: "image/png",
      size: 1024,
      updatedAt: new Date("2026-04-25T00:00:00.000Z"),
      expiresInSeconds: 900,
    });
  });

  it("rejects invalid profile photo mime types before upload", async () => {
    const prisma = { user: { findUnique: jest.fn() } };
    const storage = { profilePhotoMaxSizeBytes: 5 * 1024 * 1024 };
    const redis = mockRedis();
    const logger = mockLogger();
    fileTypeFromBufferMock.mockResolvedValue({ mime: "image/gif", ext: "gif" } as never);

    await expect(
      uploadMyProfilePhoto(prisma as never, storage as never, redis as never, logger as never, "user-1", {
        originalName: "avatar.gif",
        mimeType: "image/gif",
        size: 128,
        buffer: Buffer.from("gif"),
      })
    ).rejects.toMatchObject({ statusCode: 415 });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("uploads and replaces a current user profile photo", async () => {
    const findUnique = jest.fn(async (..._args: unknown[]) => ({
      id: "user-1",
      role: "PARENT",
      profilePhotoKey: "profile-photos/parent/user-1/old-avatar.png",
    }));
    const update = jest.fn(async (..._args: unknown[]) => ({
      profilePhotoKey: "profile-photos/parent/user-1/new-avatar.webp",
      profilePhotoOriginalName: "avatar.webp",
      profilePhotoMimeType: "image/webp",
      profilePhotoSize: 2048,
      profilePhotoUpdatedAt: new Date("2026-04-25T02:00:00.000Z"),
    }));
    const prisma = { user: { findUnique, update } };
    const storage = {
      profilePhotoMaxSizeBytes: 5 * 1024 * 1024,
      signedUrlExpiresInSeconds: 900,
      uploadProfilePhoto: jest.fn(async (..._args: unknown[]) => undefined),
      deleteProfilePhoto: jest.fn(async (..._args: unknown[]) => undefined),
      getProfilePhotoSignedUrl: jest.fn(async (..._args: unknown[]) => "https://signed.example.com/new-avatar"),
    };
    const redis = mockRedis();
    const logger = mockLogger();

    const result = await uploadMyProfilePhoto(
      prisma as never,
      storage as never,
      redis as never,
      logger as never,
      "user-1",
      {
        originalName: "avatar.webp",
        mimeType: "image/webp",
        size: 2048,
        buffer: Buffer.from("avatar"),
      }
    );

    expect(storage.uploadProfilePhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining("profile-photos/parent/user-1/"),
        contentType: "image/webp",
        contentLength: 2048,
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          profilePhotoOriginalName: "avatar.webp",
          profilePhotoMimeType: "image/webp",
          profilePhotoSize: 2048,
          profilePhotoUpdatedAt: expect.any(Date),
        }),
      })
    );
    expect(storage.deleteProfilePhoto).toHaveBeenCalledWith(
      "profile-photos/parent/user-1/old-avatar.png"
    );
    expect(redis.set).toHaveBeenCalledWith(
      "locks:profile-photo-upload:user-1",
      expect.any(String),
      "EX",
      60,
      "NX"
    );
    expect(redis.eval).toHaveBeenCalledWith(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      1,
      "locks:profile-photo-upload:user-1",
      expect.any(String)
    );
    expect(result).toEqual({
      signedUrl: "https://signed.example.com/new-avatar",
      originalName: "avatar.webp",
      mimeType: "image/webp",
      size: 2048,
      updatedAt: new Date("2026-04-25T02:00:00.000Z"),
      expiresInSeconds: 900,
      profilePhotoKey: "profile-photos/parent/user-1/new-avatar.webp",
      previousPhotoCleanupFailed: false,
    });
  });

  it("rejects missing users by id", async () => {
    const prisma = { user: { findUnique: jest.fn(async () => null) } };

    await expect(getUserById(prisma as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
