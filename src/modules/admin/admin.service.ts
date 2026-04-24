import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import type { CreateStaffInput } from "./admin.schema.js";
import { createHttpError } from "../../utils/http-error.js";
import { generatePassword } from "../../utils/password-generator.js";
import { normalizeEmail } from "../../utils/normalize.js";
import { isUniqueConstraintError } from "../../utils/prisma-errors.js";

const SALT_ROUNDS = 12;

export interface CreatedStaff {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    status: string;
  };
  password: string;
  passwordGenerated: boolean;
}

export async function createStaffAccount(
  prisma: PrismaClient,
  input: CreateStaffInput
): Promise<CreatedStaff> {
  const email = normalizeEmail(input.email);

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) throw createHttpError(409, "Email already registered");

  const passwordGenerated = input.password === undefined;
  const password = input.password ?? generatePassword();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        fullName: input.fullName,
        passwordHash,
        role: input.role,
        status: "ACTIVE",
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
      },
    });

    return { user, password, passwordGenerated };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "Email already registered");
    }
    throw error;
  }
}
