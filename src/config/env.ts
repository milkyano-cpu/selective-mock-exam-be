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

  // CORS
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // App
  APP_NAME: z.string().default("Aspire Selective Entry Preparation"),
  API_PREFIX: z.string().default("/api/v1"),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
  }

  return result.data;
}

export const env = parseEnv();
