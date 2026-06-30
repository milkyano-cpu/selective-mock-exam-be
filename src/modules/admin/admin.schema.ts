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
    emailSent: z.boolean(),
  }),
});

const forbiddenResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

// ── Tutor CRUD Schemas ──────────────────────────────────

const tutorParamsSchema = z.object({
  id: z.string().uuid("Invalid tutor ID"),
});

const listTutorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]).optional(),
  sortBy: z.enum(["fullName", "email", "createdAt", "status"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const tutorItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.string(),
  status: z.string(),
  phoneNumber: z.string().nullable(),
  address: z.string().nullable(),
  gender: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listTutorsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(tutorItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const getTutorResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: tutorItemSchema,
});

const updateTutorBodySchema = z.object({
  fullName: z
    .string()
    .min(2, "Full name must be at least 2 characters")
    .max(100)
    .optional(),
  email: z.string().email("Invalid email address").optional(),
  phoneNumber: z.string().max(20).nullable().optional(),
  address: z.string().max(255).nullable().optional(),
  gender: z.enum(["MALE", "FEMALE"]).nullable().optional(),
});

const updateTutorResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: tutorItemSchema,
});

const updateTutorStatusBodySchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"], {
    error: "Status must be ACTIVE, SUSPENDED, or BANNED",
  }),
});

const updateTutorStatusResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: tutorItemSchema,
});

const deleteTutorResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const notFoundResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

const syncTiersResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const deleteUserResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const userParamsSchema = z.object({
  id: z.string().uuid("Invalid user ID"),
});

const updateUserResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: tutorItemSchema,
});

const updateUserStatusResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: tutorItemSchema,
});

const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  role: z.enum(["STUDENT", "PARENT", "TUTOR", "ADMIN"]),
  tiers: z.string().optional(),
  sortBy: z.enum(["fullName", "email", "createdAt", "status"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

// A linked account (parent or student) returned in a user's relations list.
const relatedUserSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
});

const userItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.string(),
  status: z.string(),
  tier: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
  phoneNumber: z.string().nullable(),
  photoUrl: z.string().nullable(),
  // Student profile fields (STUDENT tab).
  gender: z.string().nullable().optional(),
  yearLevel: z.string().nullable().optional(),
  schoolName: z.string().nullable().optional(),
  // Parent profile field (PARENT tab).
  address: z.string().nullable().optional(),
  // Linked accounts: students carry `parents`, parents carry `children`.
  parents: z.array(relatedUserSchema).optional(),
  children: z.array(relatedUserSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listUsersResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(userItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

// ── Exports ─────────────────────────────────────────────

export type CreateStaffInput = z.infer<typeof createStaffBodySchema>;
export type ListTutorsQuery = z.infer<typeof listTutorsQuerySchema>;
export type TutorParams = z.infer<typeof tutorParamsSchema>;
export type UpdateTutorInput = z.infer<typeof updateTutorBodySchema>;
export type UpdateTutorStatusInput = z.infer<typeof updateTutorStatusBodySchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UserParams = z.infer<typeof userParamsSchema>;

export const { schemas: adminSchemas, $ref: adminRef } = buildJsonSchemas({
  createStaffBodySchema,
  createStaffResponseSchema,
  forbiddenResponseSchema,
  tutorParamsSchema,
  listTutorsQuerySchema,
  listTutorsResponseSchema,
  getTutorResponseSchema,
  updateTutorBodySchema,
  updateTutorResponseSchema,
  updateTutorStatusBodySchema,
  updateTutorStatusResponseSchema,
  deleteTutorResponseSchema,
  notFoundResponseSchema,
  listUsersQuerySchema,
  listUsersResponseSchema,
  syncTiersResponseSchema,
  deleteUserResponseSchema,
  userParamsSchema,
  updateUserResponseSchema,
  updateUserStatusResponseSchema,
});
