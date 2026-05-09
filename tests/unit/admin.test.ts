import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const hashMock = jest.fn();
const sendStaffWelcomeEmailMock = jest.fn();

jest.unstable_mockModule("bcryptjs", () => ({
  default: { hash: hashMock },
}));

jest.unstable_mockModule("../../src/lib/email.js", () => ({
  sendStaffWelcomeEmail: sendStaffWelcomeEmailMock,
}));

const adminService = await import("../../src/modules/admin/admin.service.js");
const adminController = await import("../../src/modules/admin/admin.controller.js");
const userCrypto = await import("../../src/utils/user-crypto.js");

const now = new Date("2026-05-08T00:00:00.000Z");

function rawUser(email = "tutor@example.com", fullName = "Tutor One", overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    ...userCrypto.encryptUserFields({ email, fullName }),
    role: "TUTOR",
    status: "ACTIVE",
    tier: "BASIC",
    phoneNumber: null,
    address: null,
    gender: "FEMALE",
    profilePhotoKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function uniqueError(message = "Unique failed") {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["email"] },
  });
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => rawUser()),
      findMany: jest.fn(async () => [rawUser("student@example.com", "Student One", { role: "STUDENT" })]),
      count: jest.fn(async () => 1),
      create: jest.fn(async () => rawUser("staff@example.com", "Staff User", { id: "staff-1", role: "ADMIN" })),
      update: jest.fn(async () => rawUser("updated@example.com", "Updated Tutor")),
    },
    subscription: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    refreshToken: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    ...overrides,
  };
}

function mockReply() {
  const reply = {
    status: jest.fn<(code: number) => typeof reply>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.status.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    query: { page: 1, limit: 10, role: "STUDENT", sortBy: "createdAt", order: "desc" },
    params: { id: "user-1" },
    body: {
      email: "staff@example.com",
      fullName: "Staff User",
      role: "ADMIN",
      password: "Secret123!",
      status: "SUSPENDED",
    },
    user: { sub: "admin-1", role: "ADMIN" },
    server: {
      prisma: mockPrisma(),
      storage: { getProfilePhotoSignedUrl: jest.fn(async () => "https://signed.example.com/photo") },
    },
    log: { info: jest.fn(), error: jest.fn() },
    ...overrides,
  };
}

describe("admin module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hashMock.mockResolvedValue("hashed-password" as never);
    sendStaffWelcomeEmailMock.mockResolvedValue(undefined as never);
  });

  it("creates staff accounts with encrypted fields and provided password", async () => {
    const prisma = mockPrisma();

    const result = await adminService.createStaffAccount(prisma as never, {
      email: "Staff@Example.com ",
      fullName: "Staff User",
      role: "ADMIN",
      password: "Secret123!",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: userCrypto.emailToBlindIndex("Staff@Example.com ") },
      select: { id: true },
    });
    expect(hashMock).toHaveBeenCalledWith("Secret123!", 12);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: userCrypto.emailToBlindIndex("Staff@Example.com "),
        passwordHash: "hashed-password",
        role: "ADMIN",
        tier: "PREMIUM",
        status: "ACTIVE",
      }),
      select: expect.any(Object),
    });
    expect(result).toEqual({
      user: expect.objectContaining({
        id: "staff-1",
        email: "staff@example.com",
        fullName: "Staff User",
        role: "ADMIN",
        status: "ACTIVE",
      }),
      password: "Secret123!",
      passwordGenerated: false,
    });
  });

  it("rejects duplicate staff emails before and during create", async () => {
    const existing = mockPrisma({
      user: { ...mockPrisma().user, findUnique: jest.fn(async () => ({ id: "existing" })) },
    });
    await expect(
      adminService.createStaffAccount(existing as never, {
        email: "staff@example.com",
        fullName: "Staff User",
        role: "TUTOR",
      })
    ).rejects.toMatchObject({ statusCode: 409, message: "Email already registered" });

    const race = mockPrisma({
      user: { ...mockPrisma().user, create: jest.fn(async () => Promise.reject(uniqueError())) },
    });
    await expect(
      adminService.createStaffAccount(race as never, {
        email: "staff@example.com",
        fullName: "Staff User",
        role: "TUTOR",
      })
    ).rejects.toMatchObject({ statusCode: 409, message: "Email already registered" });
  });

  it("syncs user tier based on active subscriptions", async () => {
    const standard = mockPrisma({
      subscription: {
        findFirst: jest.fn(async () => ({ id: "sub-1" })),
        findMany: jest.fn(async () => [{ tier: "STANDARD" }]),
      },
    });
    await expect(adminService.syncUserTier(standard as never, "student-1")).resolves.toBe("STANDARD");
    expect(standard.user.update).toHaveBeenCalledWith({ where: { id: "student-1" }, data: { tier: "STANDARD" } });

    const basic = mockPrisma();
    await expect(adminService.syncUserTier(basic as never, "student-1")).resolves.toBe("BASIC");
    expect(basic.user.update).toHaveBeenCalledWith({ where: { id: "student-1" }, data: { tier: "BASIC" } });
  });

  it("lists users and tutors with encrypted search indexes and decrypted output", async () => {
    const prisma = mockPrisma();

    const users = await adminService.listUsers(prisma as never, {
      page: 2,
      limit: 5,
      search: "Student One",
      role: "STUDENT",
      sortBy: "createdAt",
      order: "desc",
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        role: "STUDENT",
        deletedAt: null,
        OR: [
          { email: userCrypto.emailToBlindIndex("Student One") },
          { fullNameTokens: { hasEvery: expect.any(Array) } },
        ],
      },
      select: expect.any(Object),
      orderBy: { createdAt: "desc" },
      skip: 5,
      take: 5,
    });
    expect(users.data[0]).toMatchObject({ email: "student@example.com", fullName: "Student One", role: "STUDENT" });

    const tutors = await adminService.listTutors(prisma as never, {
      page: 1,
      limit: 10,
      search: "Tutor",
      status: "ACTIVE",
      sortBy: "createdAt",
      order: "asc",
    });

    expect(prisma.user.findMany).toHaveBeenLastCalledWith({
      where: {
        role: "TUTOR",
        deletedAt: null,
        status: "ACTIVE",
        OR: [
          { email: userCrypto.emailToBlindIndex("Tutor") },
          { fullNameTokens: { hasEvery: expect.any(Array) } },
        ],
      },
      select: expect.any(Object),
      orderBy: { createdAt: "asc" },
      skip: 0,
      take: 10,
    });
    expect(tutors.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
  });

  it("gets, updates, status-updates, and deletes tutors", async () => {
    const prisma = mockPrisma({
      user: {
        ...mockPrisma().user,
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(rawUser("tutor@example.com", "Tutor One") as never)
          .mockResolvedValueOnce(rawUser("tutor@example.com", "Tutor One") as never)
          .mockResolvedValueOnce(null as never)
          .mockResolvedValue(rawUser("tutor@example.com", "Tutor One") as never),
      },
    });

    await expect(adminService.getTutorById(prisma as never, "user-1")).resolves.toMatchObject({
      email: "tutor@example.com",
      fullName: "Tutor One",
    });

    const updated = await adminService.updateTutor(prisma as never, "user-1", {
      email: "new@example.com",
      fullName: "New Tutor",
      phoneNumber: "+61400000000",
      address: "1 Main Street",
      gender: "MALE",
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({
        email: userCrypto.emailToBlindIndex("new@example.com"),
        emailEncrypted: expect.any(String),
        fullName: expect.any(String),
        fullNameTokens: expect.any(Array),
        phoneNumber: expect.any(String),
        address: expect.any(String),
        gender: "MALE",
      }),
      select: expect.any(Object),
    });
    expect(updated).toMatchObject({ email: "updated@example.com", fullName: "Updated Tutor" });

    await adminService.updateTutorStatus(prisma as never, "user-1", { status: "SUSPENDED" });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { status: "SUSPENDED" },
      select: expect.any(Object),
    });

    await adminService.deleteTutor(prisma as never, "user-1");
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("handles tutor not found, email conflicts, unique update races, and generic user deletion", async () => {
    const noTutor = mockPrisma({ user: { ...mockPrisma().user, findFirst: jest.fn(async () => null) } });
    await expect(adminService.getTutorById(noTutor as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Tutor not found",
    });

    const emailConflict = mockPrisma({
      user: {
        ...mockPrisma().user,
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(rawUser() as never)
          .mockResolvedValueOnce({ id: "other-user" } as never),
      },
    });
    await expect(
      adminService.updateTutor(emailConflict as never, "user-1", { email: "used@example.com" })
    ).rejects.toMatchObject({ statusCode: 409, message: "Email already in use" });

    const uniqueRace = mockPrisma({
      user: {
        ...mockPrisma().user,
        update: jest.fn(async () => Promise.reject(uniqueError())),
      },
    });
    await expect(adminService.updateTutor(uniqueRace as never, "user-1", { fullName: "Name" })).rejects.toMatchObject({
      statusCode: 409,
      message: "Email already in use",
    });

    const deleted = mockPrisma({
      user: { ...mockPrisma().user, findUnique: jest.fn(async () => ({ id: "user-1", deletedAt: null })) },
    });
    await adminService.deleteUserById(deleted as never, "user-1");
    expect(deleted.refreshToken.updateMany).toHaveBeenCalled();
    expect(deleted.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { deletedAt: expect.any(Date) },
    });

    const missing = mockPrisma({ user: { ...mockPrisma().user, findUnique: jest.fn(async () => null) } });
    await expect(adminService.deleteUserById(missing as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "User not found",
    });

    const alreadyDeleted = mockPrisma({
      user: { ...mockPrisma().user, findUnique: jest.fn(async () => ({ id: "user-1", deletedAt: now })) },
    });
    await expect(adminService.deleteUserById(alreadyDeleted as never, "user-1")).rejects.toMatchObject({
      statusCode: 409,
      message: "User is already deleted",
    });
  });

  it("runs admin controller success paths and handles welcome email failures", async () => {
    const prisma = mockPrisma({
      user: {
        ...mockPrisma().user,
        findMany: jest.fn(async () => [
          rawUser("student@example.com", "Student One", {
            id: "student-1",
            role: "STUDENT",
            profilePhotoKey: "profiles/student-1.png",
          }),
        ]),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null as never)
          .mockResolvedValue({ id: "user-1", deletedAt: null } as never),
      },
    });
    const request = mockRequest({ server: { prisma, storage: mockRequest().server.storage } });
    const reply = mockReply();

    await expect(adminController.createStaff(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "ADMIN account created and credentials emailed",
      data: { emailSent: true },
    });
    await expect(adminController.listUsersHandler(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Users retrieved successfully",
      data: [expect.objectContaining({ photoUrl: "https://signed.example.com/photo" })],
    });
    await expect(adminController.syncAllTiersHandler(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Synced tier for 1 student(s)",
    });
    await expect(adminController.listTutors(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Tutors retrieved successfully",
    });
    await expect(adminController.getTutor(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Tutor retrieved successfully",
    });
    const updateRequest = mockRequest({
      server: { prisma, storage: request.server.storage },
      body: { fullName: "Updated Tutor" },
    });
    await expect(adminController.updateTutor(updateRequest as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Tutor updated successfully",
    });
    await expect(adminController.updateTutorStatus(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Tutor status changed to SUSPENDED",
    });
    await expect(adminController.deleteTutor(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Tutor deleted successfully",
    });
    await expect(adminController.deleteUserHandler(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "User deleted successfully.",
    });

    sendStaffWelcomeEmailMock.mockRejectedValueOnce(new Error("SMTP down") as never);
    await expect(adminController.createStaff(mockRequest() as never, mockReply() as never)).resolves.toMatchObject({
      success: true,
      message: "ADMIN account created but email delivery failed — share credentials manually",
      data: { emailSent: false },
    });
  });
});
