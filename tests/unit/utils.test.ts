import { z } from "zod";
import { Prisma } from "@prisma/client";
import { describe, expect, it, jest } from "@jest/globals";
import { normalizeEmail } from "../../src/utils/normalize.js";
import { createHttpError } from "../../src/utils/http-error.js";
import { buildJsonSchemas } from "../../src/utils/build-schemas.js";
import { generatePassword } from "../../src/utils/password-generator.js";
import { isUniqueConstraintError, mapPrismaError } from "../../src/utils/prisma-errors.js";
import {
  assertCanAccessStudent,
  assertParentOwnsStudent,
  requireRole,
} from "../../src/utils/authz.js";

function mockReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
}

describe("shared utilities", () => {
  it("normalizes email addresses", () => {
    expect(normalizeEmail(" Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });

  it("creates typed HTTP errors", () => {
    const error = createHttpError(409, "Already exists");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ statusCode: 409, message: "Already exists" });
  });

  it("builds JSON schemas and refs from zod schemas", () => {
    const { schemas, $ref } = buildJsonSchemas({
      sampleSchema: z.object({ name: z.string() }),
    });

    expect(schemas).toEqual([
      expect.objectContaining({
        $id: "sampleSchema",
        type: "object",
      }),
    ]);
    expect($ref("sampleSchema")).toEqual({ $ref: "sampleSchema#" });
  });

  it("generates readable strong passwords", () => {
    const password = generatePassword();

    expect(password).toHaveLength(12);
    expect(password).toMatch(/[A-HJ-NP-Z]/);
    expect(password).toMatch(/[a-km-z]/);
    expect(password).toMatch(/[2-9]/);
    expect(password).toMatch(/[!@#$%^&*]/);
    expect(password).not.toMatch(/[0O1Il]/);
  });

  it("maps Prisma unique constraint errors to conflict errors", () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["email"] },
    });

    expect(isUniqueConstraintError(prismaError)).toBe(true);
    expect(mapPrismaError(prismaError)).toMatchObject({
      statusCode: 409,
      message: "Resource already exists",
    });
    expect(isUniqueConstraintError(new Error("Other"))).toBe(false);
    expect(mapPrismaError(new Error("Other"))).toBeNull();
  });

  it("requires an authenticated role before allowing a route", async () => {
    const preHandler = requireRole("ADMIN");
    const reply = mockReply();

    await preHandler({ user: undefined } as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Authentication required",
      statusCode: 401,
    });
  });

  it("rejects roles that are not allowed", async () => {
    const preHandler = requireRole("ADMIN");
    const reply = mockReply();

    await preHandler({ user: { role: "STUDENT" } } as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Forbidden",
      statusCode: 403,
    });
  });

  it("allows roles that are explicitly allowed", async () => {
    const preHandler = requireRole("ADMIN", "TUTOR");
    const reply = mockReply();

    await preHandler({ user: { role: "TUTOR" } } as never, reply as never);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("checks parent ownership relationships", async () => {
    const findUnique = jest.fn().mockResolvedValue({ parentId: "parent-1" });
    const prisma = {
      parentStudentRelation: { findUnique },
    };

    await expect(
      assertParentOwnsStudent(prisma as never, "parent-1", "student-1")
    ).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith({
      where: { parentId_studentId: { parentId: "parent-1", studentId: "student-1" } },
      select: { parentId: true },
    });
  });

  it("rejects missing parent ownership relationships", async () => {
    const prisma = {
      parentStudentRelation: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      assertParentOwnsStudent(prisma as never, "parent-1", "student-1")
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("allows admin, tutor, owning student, and linked parent student access", async () => {
    const prisma = {
      parentStudentRelation: {
        findUnique: jest.fn().mockResolvedValue({ parentId: "parent-1" }),
      },
    };

    await expect(
      assertCanAccessStudent(prisma as never, { sub: "admin-1", role: "ADMIN" }, "student-1")
    ).resolves.toBeUndefined();
    await expect(
      assertCanAccessStudent(prisma as never, { sub: "tutor-1", role: "TUTOR" }, "student-1")
    ).resolves.toBeUndefined();
    await expect(
      assertCanAccessStudent(prisma as never, { sub: "student-1", role: "STUDENT" }, "student-1")
    ).resolves.toBeUndefined();
    await expect(
      assertCanAccessStudent(prisma as never, { sub: "parent-1", role: "PARENT" }, "student-1")
    ).resolves.toBeUndefined();
  });

  it("rejects unrelated student access", async () => {
    const prisma = {
      parentStudentRelation: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      assertCanAccessStudent(prisma as never, { sub: "student-2", role: "STUDENT" }, "student-1")
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      assertCanAccessStudent(prisma as never, { sub: "guest-1", role: "GUEST" }, "student-1")
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
