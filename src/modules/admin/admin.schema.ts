import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

const createStaffBodySchema = z.object({
  role: z.enum(["ADMIN", "TUTOR"], {
    error: "Role must be ADMIN or TUTOR",
  }),
  fullName: z
    .string({ error: "Full name is required" })
    .min(2, "Full name must be at least 2 characters")
    .max(100),
  email: z
    .string({ error: "Email is required" })
    .email("Invalid email address"),
  password: passwordSchema.optional(),
});

const createStaffResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    user: z.object({
      id: z.string(),
      email: z.string(),
      fullName: z.string(),
      role: z.string(),
      status: z.string(),
    }),
    // Present only when we auto-generated the password — null if admin supplied one.
    generatedPassword: z.string().nullable(),
    emailSent: z.boolean(),
  }),
});

const forbiddenResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

export type CreateStaffInput = z.infer<typeof createStaffBodySchema>;

export const { schemas: adminSchemas, $ref: adminRef } = buildJsonSchemas({
  createStaffBodySchema,
  createStaffResponseSchema,
  forbiddenResponseSchema,
});
