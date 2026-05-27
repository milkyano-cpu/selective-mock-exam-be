import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const studentSchema = z.object({
  fullName: z
    .string({ error: "Student full name is required" })
    .min(2, "Student name must be at least 2 characters")
    .max(100),
  email: z
    .string({ error: "Student email is required" })
    .email("Invalid student email address"),
  gender: z.enum(["MALE", "FEMALE"], { error: "Gender must be MALE or FEMALE" }),
  yearLevel: z
    .string({ error: "Year level is required" })
    .min(1, "Year level cannot be empty"),
  schoolName: z
    .string({ error: "School name is required" })
    .min(2, "School name must be at least 2 characters")
    .max(200),
});

const registerBodySchema = z.object({
  parent: z.object({
    fullName: z
      .string({ error: "Parent full name is required" })
      .min(2, "Name must be at least 2 characters")
      .max(100),
    email: z
      .string({ error: "Parent email is required" })
      .email("Invalid parent email address"),
    phoneNumber: z
      .string({ error: "Phone number is required" })
      .min(6, "Phone number is too short")
      .max(20),
    address: z
      .string({ error: "Address is required" })
      .min(5, "Address is too short"),
  }),
  students: z
    .array(studentSchema, { error: "Students list is required" })
    .min(1, "At least one student is required"),
});

const registerResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    parent: z.object({
      id: z.string(),
      email: z.string(),
      fullName: z.string(),
    }),
    students: z.array(
      z.object({
        id: z.string(),
        email: z.string(),
        fullName: z.string(),
      })
    ),
  }),
});

const loginBodySchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .email("Invalid email address"),
  password: z
    .string({ error: "Password is required" })
    .min(1, "Password cannot be empty"),
});

const loginResponseSchema = z.object({
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
    expiresIn: z.string(),
    accessTokenExpiresAt: z.string(),
    sessionExpiresAt: z.string(),
  }),
});

const refreshResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    accessTokenExpiresAt: z.string(),
    sessionExpiresAt: z.string(),
  }),
});

const logoutResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const changePasswordBodySchema = z.object({
  oldPassword: z.string({ error: "Old password is required" }),
  newPassword: z
    .string({ error: "New password is required" })
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
});

const changePasswordResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const forgotPasswordBodySchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .email("Invalid email address"),
});

const forgotPasswordResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const resetPasswordBodySchema = z.object({
  token: z
    .string({ error: "Token is required" })
    .length(64, "Invalid reset token"),
  newPassword: z
    .string({ error: "New password is required" })
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
});

const resetPasswordResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const validateResetTokenQuerySchema = z.object({
  token: z.string({ error: "Token is required" }),
});

const validateResetTokenResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({ valid: z.boolean() }),
});

export type RegisterInput = z.infer<typeof registerBodySchema>;
export type LoginInput = z.infer<typeof loginBodySchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordBodySchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordBodySchema>;

export const { schemas: authSchemas, $ref: authRef } = buildJsonSchemas({
  registerBodySchema,
  registerResponseSchema,
  loginBodySchema,
  loginResponseSchema,
  refreshResponseSchema,
  logoutResponseSchema,
  changePasswordBodySchema,
  changePasswordResponseSchema,
  forgotPasswordBodySchema,
  forgotPasswordResponseSchema,
  resetPasswordBodySchema,
  resetPasswordResponseSchema,
  validateResetTokenQuerySchema,
  validateResetTokenResponseSchema,
});
