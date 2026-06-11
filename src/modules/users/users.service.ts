import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import type { FastifyBaseLogger } from "fastify";
import type { Prisma, PrismaClient, Role } from "@prisma/client";
import type { Redis } from "ioredis";
import sharp from "sharp";
import type { ObjectStorage } from "../../lib/object-storage.js";
import { enqueueProfilePhotoCleanup } from "./profile-photo-cleanup.js";
import { createHttpError } from "../../utils/http-error.js";
import { decryptUser } from "../../utils/user-crypto.js";

const ALLOWED_PROFILE_PHOTO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const PROFILE_PHOTO_UPLOAD_LOCK_TTL_SECONDS = 60;

const PROFILE_SELECT = {
  id: true,
  email: true,
  emailEncrypted: true,
  fullName: true,
  role: true,
  status: true,
  tier: true,
  isForumBanned: true,
  profilePhotoKey: true,
  profilePhotoUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
  subscriptions: {
    select: {
      status: true,
      currentPeriodEnd: true,
    },
    orderBy: { currentPeriodEnd: "desc" },
    take: 1,
  },
} satisfies Prisma.UserSelect;

const PROFILE_PHOTO_ACCESS_SELECT = {
  id: true,
  profilePhotoKey: true,
  profilePhotoOriginalName: true,
  profilePhotoMimeType: true,
  profilePhotoSize: true,
  profilePhotoUpdatedAt: true,
} satisfies Prisma.UserSelect;

const PROFILE_PHOTO_UPLOAD_USER_SELECT = {
  id: true,
  role: true,
  profilePhotoKey: true,
} satisfies Prisma.UserSelect;

const PROFILE_PHOTO_RECORD_SELECT = {
  profilePhotoKey: true,
  profilePhotoOriginalName: true,
  profilePhotoMimeType: true,
  profilePhotoSize: true,
  profilePhotoUpdatedAt: true,
} satisfies Prisma.UserSelect;

type UploadMyProfilePhotoInput = {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
};

type ProfilePhotoAccess = {
  signedUrl: string;
  originalName: string | null;
  mimeType: string;
  size: number;
  updatedAt: Date;
  expiresInSeconds: number;
};

type UploadProfilePhotoResult = ProfilePhotoAccess & {
  profilePhotoKey: string;
  previousPhotoCleanupFailed: boolean;
};

type ProfilePhotoAccessRecord = Prisma.UserGetPayload<{
  select: typeof PROFILE_PHOTO_ACCESS_SELECT;
}>;

type ProfilePhotoUploadUserRecord = Prisma.UserGetPayload<{
  select: typeof PROFILE_PHOTO_UPLOAD_USER_SELECT;
}>;

type ProfilePhotoRecord = Prisma.UserGetPayload<{
  select: typeof PROFILE_PHOTO_RECORD_SELECT;
}>;

type ProfilePhotoUploadLock = {
  key: string;
  token: string;
};

function profilePhotoExtension(mimeType: string, originalName: string) {
  const byMimeType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };

  return byMimeType[mimeType] ?? (extname(originalName).toLowerCase() || ".bin");
}

function buildProfilePhotoKey(role: Role, userId: string, mimeType: string, originalName: string) {
  return `profile-photos/${role.toLowerCase()}/${userId}/${Date.now()}-${randomUUID()}${profilePhotoExtension(mimeType, originalName)}`;
}

function assertValidProfilePhotoMimeType(mimeType: string) {
  if (!ALLOWED_PROFILE_PHOTO_MIME_TYPES.has(mimeType)) {
    throw createHttpError(415, "Profile photo must be a JPEG, PNG, or WebP image");
  }
}

function assertValidProfilePhotoSize(size: number, maxSizeBytes: number) {
  if (size <= 0) {
    throw createHttpError(400, "Profile photo file is empty");
  }

  if (size > maxSizeBytes) {
    throw createHttpError(
      413,
      `Profile photo exceeds the maximum size of ${Math.ceil(maxSizeBytes / (1024 * 1024))} MB`
    );
  }
}

async function sanitizeProfilePhotoUpload(
  input: UploadMyProfilePhotoInput,
  maxSizeBytes: number
): Promise<UploadMyProfilePhotoInput> {
  assertValidProfilePhotoSize(input.size, maxSizeBytes);

  const detectedFileType = await fileTypeFromBuffer(input.buffer);

  if (!detectedFileType) {
    throw createHttpError(415, "Profile photo must be a JPEG, PNG, or WebP image");
  }

  assertValidProfilePhotoMimeType(detectedFileType.mime);

  try {
    const image = sharp(input.buffer, {
      failOn: "error",
      limitInputPixels: 4096 * 4096,
    }).rotate();

    let sanitizedBuffer: Buffer;

    switch (detectedFileType.mime) {
      case "image/jpeg":
        sanitizedBuffer = await image.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        break;
      case "image/png":
        sanitizedBuffer = await image.png({ compressionLevel: 9, palette: true }).toBuffer();
        break;
      case "image/webp":
        sanitizedBuffer = await image.webp({ quality: 85 }).toBuffer();
        break;
      default:
        throw createHttpError(415, "Profile photo must be a JPEG, PNG, or WebP image");
    }

    assertValidProfilePhotoSize(sanitizedBuffer.byteLength, maxSizeBytes);

    return {
      originalName: input.originalName,
      mimeType: detectedFileType.mime,
      size: sanitizedBuffer.byteLength,
      buffer: sanitizedBuffer,
    };
  } catch (error) {
    if (error instanceof Error && "statusCode" in error) {
      throw error;
    }

    throw createHttpError(415, "Profile photo must be a valid JPEG, PNG, or WebP image");
  }
}

async function acquireProfilePhotoUploadLock(
  redis: Redis,
  userId: string
): Promise<ProfilePhotoUploadLock> {
  const key = `locks:profile-photo-upload:${userId}`;
  const token = randomUUID();
  const acquired = await redis.set(key, token, "EX", PROFILE_PHOTO_UPLOAD_LOCK_TTL_SECONDS, "NX");

  if (acquired !== "OK") {
    throw createHttpError(409, "Another profile photo upload is already in progress");
  }

  return { key, token };
}

async function releaseProfilePhotoUploadLock(redis: Redis, lock: ProfilePhotoUploadLock) {
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
    1,
    lock.key,
    lock.token
  );
}

export async function getMyProfile(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: PROFILE_SELECT,
  });

  if (!user) {
    throw createHttpError(404, "User not found");
  }

  const { profilePhotoKey, ...profile } = decryptUser(user);

  return {
    ...profile,
    hasProfilePhoto: profilePhotoKey !== null,
  };
}

export async function getMyProfilePhotoAccess(
  prisma: PrismaClient,
  storage: ObjectStorage,
  userId: string
): Promise<ProfilePhotoAccess> {
  const user: ProfilePhotoAccessRecord | null = await prisma.user.findUnique({
    where: { id: userId },
    select: PROFILE_PHOTO_ACCESS_SELECT,
  });

  if (!user) {
    throw createHttpError(404, "User not found");
  }

  if (
    user.profilePhotoKey === null ||
    user.profilePhotoMimeType === null ||
    user.profilePhotoSize === null ||
    user.profilePhotoUpdatedAt === null
  ) {
    throw createHttpError(404, "Profile photo not found");
  }

  const signedUrl = await storage.getProfilePhotoSignedUrl(user.profilePhotoKey);

  return {
    signedUrl,
    originalName: user.profilePhotoOriginalName,
    mimeType: user.profilePhotoMimeType,
    size: user.profilePhotoSize,
    updatedAt: user.profilePhotoUpdatedAt,
    expiresInSeconds: storage.signedUrlExpiresInSeconds,
  };
}

export async function uploadMyProfilePhoto(
  prisma: PrismaClient,
  storage: ObjectStorage,
  redis: Redis,
  logger: FastifyBaseLogger,
  userId: string,
  input: UploadMyProfilePhotoInput
): Promise<UploadProfilePhotoResult> {
  const sanitizedInput = await sanitizeProfilePhotoUpload(
    input,
    storage.profilePhotoMaxSizeBytes
  );
  const uploadLock = await acquireProfilePhotoUploadLock(redis, userId);

  try {
    const user: ProfilePhotoUploadUserRecord | null = await prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_PHOTO_UPLOAD_USER_SELECT,
    });

    if (!user) {
      throw createHttpError(404, "User not found");
    }

    const nextProfilePhotoKey = buildProfilePhotoKey(
      user.role,
      user.id,
      sanitizedInput.mimeType,
      sanitizedInput.originalName
    );

    await storage.uploadProfilePhoto({
      key: nextProfilePhotoKey,
      body: sanitizedInput.buffer,
      contentType: sanitizedInput.mimeType,
      contentLength: sanitizedInput.size,
    });

    try {
      const updatedUser: ProfilePhotoRecord = await prisma.user.update({
        where: { id: user.id },
        data: {
          profilePhotoKey: nextProfilePhotoKey,
          profilePhotoOriginalName: sanitizedInput.originalName,
          profilePhotoMimeType: sanitizedInput.mimeType,
          profilePhotoSize: sanitizedInput.size,
          profilePhotoUpdatedAt: new Date(),
        },
        select: PROFILE_PHOTO_RECORD_SELECT,
      });

      if (
        updatedUser.profilePhotoKey === null ||
        updatedUser.profilePhotoMimeType === null ||
        updatedUser.profilePhotoSize === null ||
        updatedUser.profilePhotoUpdatedAt === null
      ) {
        throw createHttpError(500, "Profile photo metadata is incomplete after update");
      }

      let previousPhotoCleanupFailed = false;
      if (user.profilePhotoKey && user.profilePhotoKey !== nextProfilePhotoKey) {
        try {
          await storage.deleteProfilePhoto(user.profilePhotoKey);
        } catch (cleanupError) {
          previousPhotoCleanupFailed = true;
          logger.warn(
            {
              error: cleanupError,
              orphanProfilePhotoKey: user.profilePhotoKey,
              replacementProfilePhotoKey: nextProfilePhotoKey,
              userId: user.id,
            },
            "Failed to delete replaced profile photo; scheduling retry cleanup"
          );
          await enqueueProfilePhotoCleanup(redis, logger, {
            key: user.profilePhotoKey,
            userId: user.id,
            reason: "previous-photo-replacement-failure",
          });
        }
      }

      const signedUrl = await storage.getProfilePhotoSignedUrl(nextProfilePhotoKey);

      return {
        signedUrl,
        originalName: updatedUser.profilePhotoOriginalName,
        mimeType: updatedUser.profilePhotoMimeType,
        size: updatedUser.profilePhotoSize,
        updatedAt: updatedUser.profilePhotoUpdatedAt,
        expiresInSeconds: storage.signedUrlExpiresInSeconds,
        profilePhotoKey: updatedUser.profilePhotoKey,
        previousPhotoCleanupFailed,
      };
    } catch (error) {
      try {
        await storage.deleteProfilePhoto(nextProfilePhotoKey);
      } catch (cleanupError) {
        logger.error(
          {
            error: cleanupError,
            orphanProfilePhotoKey: nextProfilePhotoKey,
            userId: user.id,
          },
          "Failed to rollback uploaded profile photo after database update failure"
        );
        await enqueueProfilePhotoCleanup(redis, logger, {
          key: nextProfilePhotoKey,
          userId: user.id,
          reason: "upload-rollback-failure",
        });
      }

      throw error;
    }
  } finally {
    await releaseProfilePhotoUploadLock(redis, uploadLock);
  }
}

export async function softDeleteUser(prisma: PrismaClient, userId: string) {
  const now = new Date();
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: now },
  });
}

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"];

export async function softDeleteChildAccount(
  prisma: PrismaClient,
  parentId: string,
  studentId: string
) {
  // The requestor must be the parent of a still-active (not soft-deleted) student.
  const relation = await prisma.parentStudentRelation.findFirst({
    where: {
      parentId,
      studentId,
      student: { deletedAt: null },
    },
    select: { parentId: true },
  });

  if (!relation) {
    throw createHttpError(403, "Parent is not linked to this student");
  }

  const activeSubscription = await prisma.subscription.findFirst({
    where: {
      userId: studentId,
      status: { in: ACTIVE_SUBSCRIPTION_STATUSES },
    },
    select: { id: true },
  });

  if (activeSubscription) {
    throw createHttpError(
      409,
      "This account has an active subscription. Cancel it first before deleting."
    );
  }

  await softDeleteUser(prisma, studentId);
}

export async function getUserById(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailEncrypted: true,
      fullName: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw createHttpError(404, "User not found");
  }

  return decryptUser(user);
}
