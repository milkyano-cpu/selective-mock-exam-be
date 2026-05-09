import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encryptUserFields, emailToBlindIndex } from "../src/utils/user-crypto.js";

const SALT_ROUNDS = 12;

function normalizeConnectionString(url: string): string {
  // pg-connection-string treats 'require'/'prefer'/'verify-ca' as 'verify-full' today,
  // but will change semantics in pg v9. Be explicit now to silence the warning.
  return url.replace(/sslmode=(prefer|require|verify-ca)/, "sslmode=verify-full");
}

function buildPrisma(): PrismaClient {
  const connectionString =
    process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];

  if (!connectionString) {
    console.error(
      "[seed] DATABASE_URL (or DIRECT_URL) must be set in the environment."
    );
    process.exit(1);
  }

  const adapter = new PrismaPg({
    connectionString: normalizeConnectionString(connectionString),
  });

  return new PrismaClient({ adapter, log: ["warn", "error"] });
}

const prisma = buildPrisma();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "ADMIN_PASSWORD must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "ADMIN_PASSWORD must contain an uppercase letter";
  if (!/[a-z]/.test(password)) return "ADMIN_PASSWORD must contain a lowercase letter";
  if (!/[0-9]/.test(password)) return "ADMIN_PASSWORD must contain a number";
  if (!/[^A-Za-z0-9]/.test(password)) return "ADMIN_PASSWORD must contain a special character";
  return null;
}

async function main(): Promise<void> {
  const emailRaw = process.env["ADMIN_EMAIL"];
  const password = process.env["ADMIN_PASSWORD"];
  const fullName = process.env["ADMIN_FULL_NAME"] ?? "Administrator";
  const resetPassword = process.env["SEED_RESET_PASSWORD"] === "true";

  if (!emailRaw || !password) {
    console.error(
      "[seed] Missing env vars. Required: ADMIN_EMAIL, ADMIN_PASSWORD. Optional: ADMIN_FULL_NAME, SEED_RESET_PASSWORD."
    );
    process.exit(1);
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    console.error(`[seed] ${passwordError}.`);
    process.exit(1);
  }

  const email = normalizeEmail(emailRaw);
  const emailBlindIndex = emailToBlindIndex(emailRaw);
  const existing = await prisma.user.findUnique({ where: { email: emailBlindIndex } });

  if (existing) {
    if (existing.role !== "ADMIN") {
      console.error(
        `[seed] Email ${email} already exists with role ${existing.role}. Refusing to overwrite — pick a different ADMIN_EMAIL.`
      );
      process.exit(1);
    }

    if (!resetPassword) {
      console.log(
        `[seed] Admin ${email} already exists. Skipping. Set SEED_RESET_PASSWORD=true to reset the password.`
      );
      return;
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const now = new Date();
    const encrypted = encryptUserFields({ email: emailRaw, fullName });

    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: hash,
          fullName: encrypted.fullName,
          fullNameTokens: encrypted.fullNameTokens,
          status: "ACTIVE",
        },
      }),
      // Invalidate any active sessions after password reset
      prisma.refreshToken.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    console.log(`[seed] Admin ${email} password reset. Active sessions revoked.`);
    return;
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const encrypted = encryptUserFields({ email: emailRaw, fullName });

  const created = await prisma.user.create({
    data: {
      ...encrypted,
      passwordHash: hash,
      role: "ADMIN",
      tier: "PREMIUM",
      status: "ACTIVE",
    },
    select: { id: true },
  });

  console.log(`[seed] Admin created: ${email} (id: ${created.id}).`);
}

main()
  .catch((error: unknown) => {
    console.error("[seed] Failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
