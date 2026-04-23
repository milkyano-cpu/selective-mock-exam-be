import { describe, expect, it, jest } from "@jest/globals";
import { checkDbConnection } from "../../src/modules/health/health.service.js";
import { getMyProfile, getUserById } from "../../src/modules/users/users.service.js";

describe("service helpers", () => {
  it("reports connected database status", async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]) };

    await expect(checkDbConnection(prisma as never)).resolves.toBe("connected");
  });

  it("reports disconnected database status", async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error("DB down")) };

    await expect(checkDbConnection(prisma as never)).resolves.toBe("disconnected");
  });

  it("returns current user profile", async () => {
    const user = {
      id: "user-1",
      email: "user@example.com",
      fullName: "Jane Doe",
      role: "PARENT",
      status: "ACTIVE",
      createdAt: new Date(),
      updatedAt: new Date(),
      subscriptions: [],
    };
    const findUnique = jest.fn().mockResolvedValue(user);
    const prisma = { user: { findUnique } };

    await expect(getMyProfile(prisma as never, "user-1")).resolves.toBe(user);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
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
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };

    await expect(getMyProfile(prisma as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns users by id", async () => {
    const user = {
      id: "user-1",
      email: "user@example.com",
      fullName: "Jane Doe",
      role: "PARENT",
      status: "ACTIVE",
      createdAt: new Date(),
    };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };

    await expect(getUserById(prisma as never, "user-1")).resolves.toBe(user);
  });

  it("rejects missing users by id", async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };

    await expect(getUserById(prisma as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
