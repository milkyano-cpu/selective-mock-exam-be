import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import type {
  CreateStaffInput,
  ListTutorsQuery,
  ListUsersQuery,
  UpdateTutorInput,
  UpdateTutorStatusInput,
} from "./admin.schema.js";
import { createHttpError } from "../../utils/http-error.js";
import { generatePassword } from "../../utils/password-generator.js";
import { normalizeEmail } from "../../utils/normalize.js";
import { isUniqueConstraintError } from "../../utils/prisma-errors.js";
import { encryptUserFields, emailToBlindIndex, decryptUser } from "../../utils/user-crypto.js";
import { computeBlindIndex, encryptField } from "../../utils/field-encryption.js";

const SALT_ROUNDS = 12;

const TUTOR_SELECT = {
  id: true,
  email: true,
  emailEncrypted: true,
  fullName: true,
  fullNameTokens: true,
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
  const emailBlindIndex = emailToBlindIndex(input.email);

  const existing = await prisma.user.findUnique({
    where: { email: emailBlindIndex },
    select: { id: true },
  });
  if (existing) throw createHttpError(409, "Email already registered");

  const passwordGenerated = input.password === undefined;
  const password = input.password ?? generatePassword();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const encrypted = encryptUserFields({ email: input.email, fullName: input.fullName });

  try {
    const rawUser = await prisma.user.create({
      data: {
        ...encrypted,
        passwordHash,
        role: input.role,
        tier: "PREMIUM",
        status: "ACTIVE",
      },
      select: {
        id: true,
        email: true,
        emailEncrypted: true,
        fullName: true,
        role: true,
        status: true,
      },
    });

    const user = {
      ...decryptUser(rawUser),
      role: rawUser.role,
      status: rawUser.status,
    };
    return { user, password, passwordGenerated };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "Email already registered");
    }
    throw error;
  }
}

// ── Tier sync ───────────────────────────────────────────

export async function syncUserTier(
  prisma: PrismaClient,
  userId: string
): Promise<"BASIC" | "STANDARD" | "PREMIUM"> {
  const now = new Date();

  const activeSubs = await prisma.subscription.findMany({
    where: {
      userId,
      status: { in: ["active", "trialing"] },
      currentPeriodEnd: { gt: now },
    },
    select: { tier: true },
  });

  const rank = { BASIC: 0, STANDARD: 1, PREMIUM: 2 } as const;
  const tier = activeSubs.reduce<"BASIC" | "STANDARD" | "PREMIUM">(
    (best, sub) => (rank[sub.tier] > rank[best] ? sub.tier : best),
    "BASIC"
  );

  await prisma.user.update({
    where: { id: userId },
    data: { tier },
  });

  return tier;
}

// ── Generic list users by role ───────────────────────────

const USER_SELECT = {
  id: true,
  email: true,
  emailEncrypted: true,
  fullName: true,
  fullNameTokens: true,
  role: true,
  status: true,
  tier: true,
  phoneNumber: true,
  profilePhotoKey: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listUsers(
  prisma: PrismaClient,
  query: ListUsersQuery
) {
  const { page, limit, search, role, tiers, sortBy, order } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { role, deletedAt: null };

  if (tiers) {
    const allowedTiers = new Set(["BASIC", "STANDARD", "PREMIUM"]);
    const selectedTiers = tiers
      .split(",")
      .map((tier) => tier.trim().toUpperCase())
      .filter((tier): tier is "BASIC" | "STANDARD" | "PREMIUM" => allowedTiers.has(tier));

    if (selectedTiers.length > 0) {
      where.tier = { in: [...new Set(selectedTiers)] };
    }
  }

  if (search) {
    const nameTokens = search.toLowerCase().split(/\s+/).filter(Boolean).map(computeBlindIndex);
    where.OR = [
      { email: emailToBlindIndex(search) },
      { fullNameTokens: { hasEvery: nameTokens } },
    ];
  }

  const [rawUsers, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { [sortBy]: order },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data: rawUsers.map((u) => {
      const { fullNameTokens, ...rest } = decryptUser(u);
      return rest;
    }),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// ── Tutor CRUD ──────────────────────────────────────────

export async function listTutors(
  prisma: PrismaClient,
  query: ListTutorsQuery
) {
  const { page, limit, search, status, sortBy, order } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { role: "TUTOR" as const, deletedAt: null };

  if (status) {
    where.status = status;
  }

  if (search) {
    const nameTokens = search.toLowerCase().split(/\s+/).filter(Boolean).map(computeBlindIndex);
    where.OR = [
      { email: emailToBlindIndex(search) },
      { fullNameTokens: { hasEvery: nameTokens } },
    ];
  }

  const [rawTutors, total] = await Promise.all([
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
    data: rawTutors.map((t) => {
      const { fullNameTokens, ...rest } = decryptUser(t);
      return rest;
    }),
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
  const { fullNameTokens, ...rest } = decryptUser(tutor);
  return rest;
}

export async function updateTutor(
  prisma: PrismaClient,
  id: string,
  input: UpdateTutorInput
) {
  await getTutorById(prisma, id);

  // Build update data, encrypting PII fields as needed
  const data: Record<string, unknown> = {};

  if (input.email !== undefined) {
    const newBlindIndex = emailToBlindIndex(input.email);
    const existing = await prisma.user.findFirst({
      where: { email: newBlindIndex, id: { not: id } },
      select: { id: true },
    });
    if (existing) throw createHttpError(409, "Email already in use");
    data.email = newBlindIndex;
    data.emailEncrypted = encryptField(normalizeEmail(input.email));
  }

  if (input.fullName !== undefined) {
    const encrypted = encryptUserFields({ email: "", fullName: input.fullName });
    data.fullName = encrypted.fullName;
    data.fullNameTokens = encrypted.fullNameTokens;
  }

  if (input.phoneNumber !== undefined) {
    data.phoneNumber = input.phoneNumber !== null ? encryptField(input.phoneNumber) : null;
  }

  if (input.address !== undefined) {
    data.address = input.address !== null ? encryptField(input.address) : null;
  }

  if (input.gender !== undefined) data.gender = input.gender;

  try {
    const rawTutor = await prisma.user.update({
      where: { id },
      data,
      select: TUTOR_SELECT,
    });
    const { fullNameTokens, ...rest } = decryptUser(rawTutor);
    return rest;
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

  const rawTutor = await prisma.user.update({
    where: { id },
    data: { status: input.status },
    select: TUTOR_SELECT,
  });

  const { fullNameTokens, ...rest } = decryptUser(rawTutor);
  return rest;
}

export async function deleteTutor(prisma: PrismaClient, id: string) {
  await getTutorById(prisma, id);

  const now = new Date();
  await prisma.refreshToken.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: now },
  });
  await prisma.user.update({ where: { id }, data: { deletedAt: now } });
}

export async function updateUserStatusById(
  prisma: PrismaClient,
  id: string,
  input: UpdateTutorStatusInput,
  actorId: string
) {
  if (id === actorId) {
    throw createHttpError(403, "You cannot change your own status");
  }

  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!user) throw createHttpError(404, "User not found");
  if (user.role !== "TUTOR" && user.role !== "ADMIN") {
    throw createHttpError(403, "Only TUTOR and ADMIN accounts can change status here");
  }

  // Suspending/banning should kick the user out of any active session so the
  // restriction takes effect immediately, not on next token refresh.
  if (input.status === "SUSPENDED" || input.status === "BANNED") {
    await prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  const rawUser = await prisma.user.update({
    where: { id },
    data: { status: input.status },
    select: TUTOR_SELECT,
  });

  const { fullNameTokens, ...rest } = decryptUser(rawUser);
  return rest;
}

export async function updateUserById(
  prisma: PrismaClient,
  id: string,
  input: UpdateTutorInput
) {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!user) throw createHttpError(404, "User not found");
  if (user.role !== "TUTOR" && user.role !== "ADMIN") {
    throw createHttpError(403, "Only TUTOR and ADMIN accounts can be edited here");
  }

  const data: Record<string, unknown> = {};

  if (input.email !== undefined) {
    const newBlindIndex = emailToBlindIndex(input.email);
    const existing = await prisma.user.findFirst({
      where: { email: newBlindIndex, id: { not: id } },
      select: { id: true },
    });
    if (existing) throw createHttpError(409, "Email already in use");
    data.email = newBlindIndex;
    data.emailEncrypted = encryptField(normalizeEmail(input.email));
  }

  if (input.fullName !== undefined) {
    const encrypted = encryptUserFields({ email: "", fullName: input.fullName });
    data.fullName = encrypted.fullName;
    data.fullNameTokens = encrypted.fullNameTokens;
  }

  if (input.phoneNumber !== undefined) {
    data.phoneNumber = input.phoneNumber !== null ? encryptField(input.phoneNumber) : null;
  }

  if (input.address !== undefined) {
    data.address = input.address !== null ? encryptField(input.address) : null;
  }

  if (input.gender !== undefined) data.gender = input.gender;

  try {
    const rawUser = await prisma.user.update({
      where: { id },
      data,
      select: TUTOR_SELECT,
    });
    const { fullNameTokens, ...rest } = decryptUser(rawUser);
    return rest;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "Email already in use");
    }
    throw error;
  }
}

export async function deleteUserById(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw createHttpError(404, "User not found");

  const activeSubscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ["active", "trialing"] },
    },
    select: { id: true },
  });
  if (activeSubscription) {
    throw createHttpError(
      409,
      "This account has an active subscription. The parent must cancel it before the account can be deleted."
    );
  }

  const now = new Date();
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  await prisma.user.update({ where: { id: userId }, data: { deletedAt: now } });
}
