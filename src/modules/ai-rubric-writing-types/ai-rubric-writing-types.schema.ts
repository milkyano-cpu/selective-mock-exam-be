import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Domain objects ───────────────────────────────────────────────────────────

const aiRubricWritingTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ── Request schemas ──────────────────────────────────────────────────────────

const writingTypeParamsSchema = z.object({
  id: z.string({ error: "Writing type id is required" }).min(1),
});

const createWritingTypeBodySchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name must not be empty")
    .max(50, "Name must be at most 50 characters")
    .regex(/^[A-Z0-9_]+$/, "Name must be uppercase letters, digits, or underscore"),
});

const updateWritingTypeBodySchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name must not be empty")
    .max(50, "Name must be at most 50 characters")
    .regex(/^[A-Z0-9_]+$/, "Name must be uppercase letters, digits, or underscore"),
});

// ── Response schemas ─────────────────────────────────────────────────────────

const listWritingTypesResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(aiRubricWritingTypeSchema),
});

const singleWritingTypeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: aiRubricWritingTypeSchema,
});

const deleteWritingTypeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const forbiddenResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  statusCode: z.number(),
});

const notFoundResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  statusCode: z.number(),
});

// ── Type exports ─────────────────────────────────────────────────────────────

export type WritingTypeParams = z.infer<typeof writingTypeParamsSchema>;
export type CreateWritingTypeInput = z.infer<typeof createWritingTypeBodySchema>;
export type UpdateWritingTypeInput = z.infer<typeof updateWritingTypeBodySchema>;

export const { schemas: aiRubricWritingTypeSchemas, $ref: aiRubricWritingTypeRef } = buildJsonSchemas({
  writingTypeParamsSchema,
  createWritingTypeBodySchema,
  updateWritingTypeBodySchema,
  listWritingTypesResponseSchema,
  singleWritingTypeResponseSchema,
  deleteWritingTypeResponseSchema,
  aiRubricWritingTypeForbiddenResponseSchema: forbiddenResponseSchema,
  aiRubricWritingTypeNotFoundResponseSchema: notFoundResponseSchema,
});
