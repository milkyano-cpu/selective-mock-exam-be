import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import type { RegisterInput, LoginInput, ChangePasswordInput } from "./auth.schema.js";
import { createHttpError } from "../../utils/http-error.js";
import { generatePassword } from "../../utils/password-generator.js";
import { normalizeEmail } from "../../utils/normalize.js";
import { isUniqueConstraintError } from "../../utils/prisma-errors.js";

const SALT_ROUNDS = 12;

export interface RegisteredAccount {
  id: string;
  email: string;
  fullName: string;
  password: string; // plain text — only returned to be sent via email, never stored
}

export interface RegisterParentResult {
  parent: RegisteredAccount;
  students: RegisteredAccount[];
}

function expiryToDate(expiry: string): Date {
  const unit = expiry.at(-1) ?? "";
  const value = parseInt(expiry.slice(0, -1), 10);
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return new Date(Date.now() + value * (multipliers[unit] ?? 0));
}

export async function registerParentWithStudents(
  prisma: PrismaClient,
  input: RegisterInput
): Promise<RegisterParentResult> {
  const parentInput = {
    ...input.parent,
    email: normalizeEmail(input.parent.email),
  };
  const studentInputs = input.students.map((student) => ({
    ...student,
    email: normalizeEmail(student.email),
  }));
  const allEmails = [parentInput.email, ...studentInputs.map((s) => s.email)];

  // Reject duplicates inside the request itself
  if (new Set(allEmails).size !== allEmails.length) {
    throw createHttpError(400, "Duplicate email addresses in the request");
  }

  // Check all emails against the DB in one query
  const existing = await prisma.user.findMany({
    where: { email: { in: allEmails } },
    select: { email: true },
  });

  if (existing.length > 0) {
    throw createHttpError(
      409,
      `Email already registered: ${existing.map((u) => u.email).join(", ")}`
    );
  }

  // Generate plain-text passwords (returned to caller for emailing)
  const parentPassword = generatePassword();
  const parentHash = await bcrypt.hash(parentPassword, SALT_ROUNDS);

  const studentPasswords = input.students.map(() => generatePassword());
  const studentHashes = await Promise.all(
    studentPasswords.map((p) => bcrypt.hash(p, SALT_ROUNDS))
  );

  // Create everything atomically. If a unique constraint wins a race, return 409.
  let result: {
    parent: { id: string; email: string; fullName: string };
    students: { id: string; email: string; fullName: string }[];
  };

  try {
    result = await prisma.$transaction(async (tx) => {
      const parent = await tx.user.create({
        data: {
          email: parentInput.email,
          fullName: parentInput.fullName,
          passwordHash: parentHash,
          role: "PARENT",
          phoneNumber: parentInput.phoneNumber,
          address: parentInput.address,
        },
        select: { id: true, email: true, fullName: true },
      });

      const students = await Promise.all(
        studentInputs.map((s, i) =>
          tx.user.create({
            data: {
              email: s.email,
              fullName: s.fullName,
              passwordHash: studentHashes[i]!,
              role: "STUDENT",
              gender: s.gender,
              yearLevel: s.yearLevel,
              schoolName: s.schoolName,
            },
            select: { id: true, email: true, fullName: true },
          })
        )
      );

      await tx.parentStudentRelation.createMany({
        data: students.map((s) => ({
          parentId: parent.id,
          studentId: s.id,
        })),
      });

      return { parent, students };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "Email already registered");
    }
    throw error;
  }

  return {
    parent: { ...result.parent, password: parentPassword },
    students: result.students.map((s, i) => ({
      ...s,
      password: studentPasswords[i]!,
    })),
  };
}

export async function loginUser(prisma: PrismaClient, input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(input.email) },
  });

  if (!user) {
    throw createHttpError(401, "Invalid email or password");
  }

  if (user.status !== "ACTIVE") {
    throw createHttpError(
      403,
      `Your account is ${user.status}. Please contact an admin.`
    );
  }

  const isValid = await bcrypt.compare(input.password, user.passwordHash);

  if (!isValid) {
    throw createHttpError(401, "Invalid email or password");
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
  };
}

export async function findUserById(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, role: true, status: true },
  });

  if (!user) throw createHttpError(404, "User not found");

  if (user.status !== "ACTIVE") {
    throw createHttpError(
      403,
      `Your account is ${user.status.toLowerCase()}. Please contact an admin.`
    );
  }

  return user;
}

// Marks all active sessions for the user as revoked.
// Called on login to enforce the single active device policy.
export async function invalidatePreviousSessions(
  prisma: PrismaClient,
  userId: string
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
}

export async function createRefreshToken(
  prisma: PrismaClient,
  userId: string,
  jti: string,
  expiresIn: string
): Promise<string> {
  const token = randomBytes(40).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  await prisma.refreshToken.create({
    data: { userId, tokenHash, jti, expiresAt: expiryToDate(expiresIn) },
  });

  return token;
}

export async function rotateRefreshToken(
  prisma: PrismaClient,
  token: string,
  newJti: string,
  expiresIn: string
): Promise<{ newRefreshToken: string; userId: string }> {
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const now = new Date();
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt <= now) {
    throw createHttpError(401, "Invalid or expired refresh token");
  }

  const newToken = randomBytes(40).toString("hex");
  const newTokenHash = createHash("sha256").update(newToken).digest("hex");

  await prisma.$transaction(async (tx) => {
    const revoked = await tx.refreshToken.updateMany({
      where: {
        id: stored.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    if (revoked.count !== 1) {
      throw createHttpError(401, "Invalid or expired refresh token");
    }

    await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: newTokenHash,
        jti: newJti,
        expiresAt: expiryToDate(expiresIn),
      },
    });
  });

  return { newRefreshToken: newToken, userId: stored.userId };
}

// Revokes the session associated with the given jti.
export async function revokeSession(prisma: PrismaClient, jti: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { jti, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Invalidates all other sessions except the current one
export async function invalidateOtherSessions(
  prisma: PrismaClient,
  userId: string,
  currentJti: string
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: {
      userId,
      jti: { not: currentJti },
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { revokedAt: new Date() },
  });
}

export async function changeUserPassword(
  prisma: PrismaClient,
  userId: string,
  input: ChangePasswordInput,
  currentJti: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) throw createHttpError(404, "User not found");

  const isValid = await bcrypt.compare(input.oldPassword, user.passwordHash);
  if (!isValid) throw createHttpError(400, "Invalid old password");

  const newHash = await bcrypt.hash(input.newPassword, SALT_ROUNDS);
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    }),
    prisma.refreshToken.updateMany({
      where: {
        userId,
        jti: { not: currentJti },
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    }),
  ]);
}
