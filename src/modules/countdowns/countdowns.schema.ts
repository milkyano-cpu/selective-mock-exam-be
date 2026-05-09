import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const createCountdownBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  targetAt: z.string().datetime(),
});

const updateCountdownBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  targetAt: z.string().datetime().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided",
});

const countdownItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  targetAt: z.string(),
  isActive: z.boolean(),
  isExpired: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listCountdownsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const listCountdownsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(countdownItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const countdownResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: countdownItemSchema,
});

const activeCountdownResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: countdownItemSchema.nullable(),
});

const deleteCountdownResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const countdownIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateCountdownBody = z.infer<typeof createCountdownBodySchema>;
export type UpdateCountdownBody = z.infer<typeof updateCountdownBodySchema>;
export type ListCountdownsQuery = z.infer<typeof listCountdownsQuerySchema>;

export const { schemas: countdownSchemas, $ref: countdownRef } = buildJsonSchemas({
  createCountdownBodySchema,
  updateCountdownBodySchema,
  countdownItemSchema,
  listCountdownsQuerySchema,
  listCountdownsResponseSchema,
  countdownResponseSchema,
  activeCountdownResponseSchema,
  deleteCountdownResponseSchema,
  countdownIdParamSchema,
});
