import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { PrismaClient } from "@prisma/client";
import {
  changeUserPassword,
  createRefreshToken,
  findUserById,
  invalidateOtherSessions,
  invalidatePreviousSessions,
  loginUser,
  registerParentWithStudents,
  revokeSession,
  rotateRefreshToken,
} from "../../src/modules/auth/auth.service.js";
import type { RegisterInput } from "../../src/modules/auth/auth.schema.js";

function baseRegisterInput(overrides: Partial<RegisterInput> = {}): RegisterInput {
  return {
    parent: {
      fullName: "Jane Doe",
      email: "Jane@Example.com ",
      phoneNumber: "+61412345678",
      address: "123 Main Street",
    },
    students: [
      {
        fullName: "Alex Doe",
        email: "alex@example.com",
        gender: "MALE",
        yearLevel: "Year 7",
        schoolName: "Melbourne High School",
      },
    ],
    ...overrides,
  };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("auth service hardening", () => {
  it("registers a parent with students successfully and normalizes emails", async () => {
    const tx = {
      user: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: "parent-1", email: "jane@example.com", fullName: "Jane Doe" })
          .mockResolvedValueOnce({ id: "student-1", email: "alex@example.com", fullName: "Alex Doe" }),
      },
      parentStudentRelation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    const result = await registerParentWithStudents(prisma, baseRegisterInput());

    expect(tx.user.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ email: "jane@example.com", role: "PARENT" }),
      })
    );
    expect(tx.user.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ email: "alex@example.com", role: "STUDENT" }),
      })
    );
    expect(tx.parentStudentRelation.createMany).toHaveBeenCalledWith({
      data: [{ parentId: "parent-1", studentId: "student-1" }],
    });
    expect(result.parent).toEqual(
      expect.objectContaining({ id: "parent-1", email: "jane@example.com", password: expect.any(String) })
    );
    expect(result.students[0]).toEqual(
      expect.objectContaining({ id: "student-1", email: "alex@example.com", password: expect.any(String) })
    );
  });

  it("maps registration unique constraint races to 409", async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["email"] },
    });
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockRejectedValue(prismaError),
    } as unknown as PrismaClient;

    await expect(registerParentWithStudents(prisma, baseRegisterInput())).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("passes through non-unique registration transaction errors", async () => {
    const error = new Error("Database unavailable");
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockRejectedValue(error),
    } as unknown as PrismaClient;

    await expect(registerParentWithStudents(prisma, baseRegisterInput())).rejects.toBe(error);
  });

  it("rejects duplicate emails inside one registration request after normalization", async () => {
    const prisma = { user: { findMany: jest.fn() } } as unknown as PrismaClient;

    await expect(
      registerParentWithStudents(
        prisma,
        baseRegisterInput({
          students: [{ fullName: "Alex Doe", email: " jane@example.com", gender: "MALE", yearLevel: "Year 7", schoolName: "Melbourne High School" }],
        })
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("rejects emails that already exist in the database", async () => {
    const findMany = jest.fn().mockResolvedValue([{ email: "jane@example.com" }]);
    const prisma = { user: { findMany } } as unknown as PrismaClient;

    await expect(registerParentWithStudents(prisma, baseRegisterInput())).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { email: { in: ["jane@example.com", "alex@example.com"] } },
      select: { email: true },
    });
  });

  it("logs in active users with a valid password", async () => {
    const passwordHash = await bcrypt.hash("Password1!", 4);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          email: "jane@example.com",
          passwordHash,
          fullName: "Jane Doe",
          role: "PARENT",
          status: "ACTIVE",
        }),
      },
    } as unknown as PrismaClient;

    await expect(loginUser(prisma, { email: "jane@example.com", password: "Password1!" })).resolves.toEqual({
      id: "user-1",
      email: "jane@example.com",
      fullName: "Jane Doe",
      role: "PARENT",
      status: "ACTIVE",
    });
  });

  it("allows login only for ACTIVE users and normalizes email lookup", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: "user-1",
      email: "jane@example.com",
      passwordHash: "not-used",
      fullName: "Jane Doe",
      role: "PARENT",
      status: "SUSPENDED",
    });
    const prisma = { user: { findUnique } } as unknown as PrismaClient;

    await expect(
      loginUser(prisma, { email: " Jane@Example.com ", password: "Password1!" })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(findUnique).toHaveBeenCalledWith({ where: { email: "jane@example.com" } });
  });

  it("rejects missing users and invalid passwords on login", async () => {
    const missingPrisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaClient;
    await expect(
      loginUser(missingPrisma, { email: "none@example.com", password: "Password1!" })
    ).rejects.toMatchObject({ statusCode: 401 });

    const invalidPasswordPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          passwordHash: await bcrypt.hash("Password1!", 4),
          status: "ACTIVE",
        }),
      },
    } as unknown as PrismaClient;
    await expect(
      loginUser(invalidPasswordPrisma, { email: "jane@example.com", password: "WrongPassword1!" })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("finds active users by id and rejects missing or inactive users", async () => {
    const activeUser = {
      id: "user-1",
      email: "user@example.com",
      fullName: "Jane Doe",
      role: "PARENT",
      status: "ACTIVE",
    };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(activeUser) } } as unknown as PrismaClient;

    await expect(findUserById(prisma, "user-1")).resolves.toBe(activeUser);
    await expect(
      findUserById({ user: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaClient, "missing")
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      findUserById(
        { user: { findUnique: jest.fn().mockResolvedValue({ ...activeUser, status: "BANNED" }) } } as unknown as PrismaClient,
        "user-1"
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("invalidates session groups", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { refreshToken: { updateMany } } as unknown as PrismaClient;

    await invalidatePreviousSessions(prisma, "user-1");
    await revokeSession(prisma, "jti-1");
    await invalidateOtherSessions(prisma, "user-1", "jti-1");

    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it("creates refresh tokens with hashed storage and supported expiries", async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { refreshToken: { create } } as unknown as PrismaClient;

    await createRefreshToken(prisma, "user-1", "jti-s", "1s");
    await createRefreshToken(prisma, "user-1", "jti-m", "1m");
    await createRefreshToken(prisma, "user-1", "jti-h", "1h");
    await createRefreshToken(prisma, "user-1", "jti-d", "1d");
    await createRefreshToken(prisma, "user-1", "jti-unknown", "1w");
    await createRefreshToken(prisma, "user-1", "jti-empty", "");

    expect(create).toHaveBeenCalledTimes(6);
    const rawData = create.mock.calls[0]![0].data;
    expect(rawData.tokenHash).toEqual(expect.any(String));
    expect(rawData.tokenHash).toHaveLength(64);
    expect(rawData.tokenHash).not.toContain("refresh");
  });

  it("rejects missing, revoked, and expired refresh tokens", async () => {
    const prisma = {
      refreshToken: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: "refresh-1",
            userId: "user-1",
            tokenHash: tokenHash("refresh-token"),
            jti: "old-jti",
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: new Date(),
            createdAt: new Date(),
          })
          .mockResolvedValueOnce({
            id: "refresh-1",
            userId: "user-1",
            tokenHash: tokenHash("refresh-token"),
            jti: "old-jti",
            expiresAt: new Date(Date.now() - 60_000),
            revokedAt: null,
            createdAt: new Date(),
          }),
      },
    } as unknown as PrismaClient;

    await expect(rotateRefreshToken(prisma, "refresh-token", "new-jti-1", "7d")).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(rotateRefreshToken(prisma, "refresh-token", "new-jti-2", "7d")).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(rotateRefreshToken(prisma, "refresh-token", "new-jti-3", "7d")).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("rejects refresh token reuse after successful rotation", async () => {
    const stored = {
      id: "refresh-1",
      userId: "user-1",
      tokenHash: tokenHash("refresh-token"),
      jti: "old-jti",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: new Date(),
    };
    const tx = {
      refreshToken: {
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      refreshToken: { findUnique: jest.fn().mockResolvedValue(stored) },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(rotateRefreshToken(prisma, "refresh-token", "new-jti-1", "7d")).resolves.toMatchObject({
      userId: "user-1",
    });
    await expect(rotateRefreshToken(prisma, "refresh-token", "new-jti-2", "7d")).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("allows only one parallel refresh rotation to succeed for the same token", async () => {
    const stored = {
      id: "refresh-1",
      userId: "user-1",
      tokenHash: tokenHash("refresh-token"),
      jti: "old-jti",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: new Date(),
    };
    let revoked = false;
    const tx = {
      refreshToken: {
        updateMany: jest.fn(async () => {
          if (revoked) return { count: 0 };
          revoked = true;
          return { count: 1 };
        }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      refreshToken: { findUnique: jest.fn().mockResolvedValue(stored) },
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    const results = await Promise.allSettled([
      rotateRefreshToken(prisma, "refresh-token", "new-jti-1", "7d"),
      rotateRefreshToken(prisma, "refresh-token", "new-jti-2", "7d"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("changes password only after old password validation and revokes other sessions", async () => {
    const oldHash = await bcrypt.hash("OldPassword1!", 4);
    const userUpdate = jest.fn().mockResolvedValue({});
    const tokenUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
    const transaction = jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ passwordHash: oldHash }), update: userUpdate },
      refreshToken: { updateMany: tokenUpdateMany },
      $transaction: transaction,
    } as unknown as PrismaClient;

    await changeUserPassword(
      prisma,
      "user-1",
      { oldPassword: "OldPassword1!", newPassword: "NewPassword1!" },
      "current-jti"
    );

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: expect.any(String) },
    });
    expect(tokenUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        jti: { not: "current-jti" },
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("does not update password when old password is invalid", async () => {
    const oldHash = await bcrypt.hash("OldPassword1!", 4);
    const transaction = jest.fn();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ passwordHash: oldHash }) },
      $transaction: transaction,
    } as unknown as PrismaClient;

    await expect(
      changeUserPassword(
        prisma,
        "user-1",
        { oldPassword: "WrongPassword1!", newPassword: "NewPassword1!" },
        "current-jti"
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects password changes for missing users", async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaClient;

    await expect(
      changeUserPassword(
        prisma,
        "missing",
        { oldPassword: "OldPassword1!", newPassword: "NewPassword1!" },
        "jti-1"
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
