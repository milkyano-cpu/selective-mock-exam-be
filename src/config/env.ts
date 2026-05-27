import { z } from "zod";

const envSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),

  // Database
  DATABASE_URL: z.string().url({ error: "DATABASE_URL must be a valid URL" }),
  DIRECT_URL: z.string().url({ error: "DIRECT_URL must be a valid URL" }).optional(),

  // Redis
  REDIS_URL: z.string({ error: "REDIS_URL is required" }).min(1, "REDIS_URL cannot be empty"),

  // JWT
  JWT_SECRET: z
    .string()
    .min(32, { error: "JWT_SECRET must be at least 32 characters long" }),
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),

  // Email (Resend)
  RESEND_API_KEY: z
    .string({ error: "RESEND_API_KEY is required" })
    .min(1, "RESEND_API_KEY cannot be empty"),
  EMAIL_FROM: z.string({ error: "EMAIL_FROM is required" }).min(1),
  APP_LOGIN_URL: z.string().url().default("http://localhost:3000/login"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  PASSWORD_RESET_EXPIRES_IN: z.string().default("1h"),

  // Object Storage (MinIO / S3)
  S3_ENDPOINT: z.string().url({ error: "S3_ENDPOINT must be a valid URL" }),
  S3_PUBLIC_ENDPOINT: z.string().url({ error: "S3_PUBLIC_ENDPOINT must be a valid URL" }).optional(),
  S3_ACCESS_KEY: z.string({ error: "S3_ACCESS_KEY is required" }).min(1),
  S3_SECRET_KEY: z.string({ error: "S3_SECRET_KEY is required" }).min(1),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z
    .string({ error: "S3_BUCKET is required" })
    .min(1, "S3_BUCKET cannot be empty"),
  S3_BUCKET_INIT_TIMEOUT_MS: z.coerce.number().int().min(500).default(3000),
  S3_SIGNED_URL_EXPIRES_IN_SECONDS: z.coerce.number().int().min(60).default(3600),
  PROFILE_PHOTO_MAX_SIZE_BYTES: z.coerce.number().int().min(1).default(5 * 1024 * 1024),
  IMAGE_MAX_SIZE_BYTES: z.coerce.number().int().min(1).default(10 * 1024 * 1024),
  BANNER_IMAGE_MAX_SIZE_BYTES: z.coerce.number().int().min(1).default(10 * 1024 * 1024),
  RESOURCE_FILE_MAX_SIZE_BYTES: z.coerce.number().int().min(1).default(50 * 1024 * 1024),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_STANDARD_PRICE_ID: z.string().optional(),
  STRIPE_PREMIUM_PRICE_ID: z.string().optional(),

  // VAPID Keys for Web Push
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_EMAIL: z.string().optional(),

  // AI (Anthropic) — optional; AI features disabled if API key not set.
  // All values must be set in .env (no hardcoded fallbacks).
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_GRADING_MODEL: z.string().optional(),
  ANTHROPIC_GRADING_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  ANTHROPIC_GRADING_MAX_RETRIES: z.coerce.number().int().min(0).max(10).optional(),
  ANTHROPIC_INSIGHTS_MODEL: z.string().optional(),

  // Field-level encryption
  FIELD_ENCRYPTION_KEY: z
    .string({ error: "FIELD_ENCRYPTION_KEY is required" })
    .length(64, { error: "FIELD_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)" }),
  BLIND_INDEX_KEY: z
    .string({ error: "BLIND_INDEX_KEY is required" })
    .length(64, { error: "BLIND_INDEX_KEY must be exactly 64 hex characters (32 bytes)" }),

  // CORS
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // App
  APP_NAME: z.string().default("Aspire Selective Entry Preparation"),
  API_PREFIX: z.string().default("/api/v1"),
});

export type Env = z.infer<typeof envSchema>;

const TEST_ENV_DEFAULTS = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/aspire_test",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "test-jwt-secret-with-at-least-32-chars",
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "Aspire <test@example.com>",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "test-access-key",
  S3_SECRET_KEY: "test-secret-key",
  S3_BUCKET: "aspire-test",
  FIELD_ENCRYPTION_KEY: "0".repeat(64),
  BLIND_INDEX_KEY: "1".repeat(64),
} as const;

function parseEnv(): Env {
  const rawEnv =
    process.env["NODE_ENV"] === "test"
      ? {
          ...TEST_ENV_DEFAULTS,
          ...process.env,
        }
      : process.env;

  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
  }

  return result.data;
}

export const env = parseEnv();
