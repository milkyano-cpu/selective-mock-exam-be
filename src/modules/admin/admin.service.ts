import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import type {
  CreateStaffInput,
  ListTutorsQuery,
  UpdateTutorInput,
  UpdateTutorStatusInput,
} from "./admin.schema.js";
import { createHttpError } from "../../utils/http-error.js";
import { generatePassword } from "../../utils/password-generator.js";
import { normalizeEmail } from "../../utils/normalize.js";
import { isUniqueConstraintError } from "../../utils/prisma-errors.js";

const SALT_ROUNDS = 12;

const TUTOR_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  status: true,
  phoneNumber: true,
  address: true,
  gender: true,
  createdAt: true,
  updatedAt: true,
} as const;

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

// ── Tutor CRUD ──────────────────────────────────────────

export async function listTutors(
  prisma: PrismaClient,
  query: ListTutorsQuery
) {
  const { page, limit, search, status, sortBy, order } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { role: "TUTOR" as const };

  if (status) {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [tutors, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: TUTOR_SELECT,
      orderBy: { [sortBy]: order },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data: tutors,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getTutorById(prisma: PrismaClient, id: string) {
  const tutor = await prisma.user.findFirst({
    where: { id, role: "TUTOR" },
    select: TUTOR_SELECT,
  });

  if (!tutor) throw createHttpError(404, "Tutor not found");
  return tutor;
}

export async function updateTutor(
  prisma: PrismaClient,
  id: string,
  input: UpdateTutorInput
) {
  await getTutorById(prisma, id);

  if (input.email) {
    input.email = normalizeEmail(input.email);
    const existing = await prisma.user.findFirst({
      where: { email: input.email, id: { not: id } },
      select: { id: true },
    });
    if (existing) throw createHttpError(409, "Email already in use");
  }

  const data = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined)
  );

  try {
    const tutor = await prisma.user.update({
      where: { id },
      data,
      select: TUTOR_SELECT,
    });
    return tutor;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "Email already in use");
    }
    throw error;
  }
}

export async function updateTutorStatus(
  prisma: PrismaClient,
  id: string,
  input: UpdateTutorStatusInput
) {
  await getTutorById(prisma, id);

  const tutor = await prisma.user.update({
    where: { id },
    data: { status: input.status },
    select: TUTOR_SELECT,
  });

  return tutor;
}

export async function deleteTutor(prisma: PrismaClient, id: string) {
  await getTutorById(prisma, id);

  await prisma.user.delete({ where: { id } });
}
