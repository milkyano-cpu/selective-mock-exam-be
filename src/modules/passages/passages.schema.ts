import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Request schemas ───────────────────────────────────────────────────────────

const createPassageBodySchema = z.object({
  title:                z.string().min(1).max(500).optional(),
  content:              z.string().min(1).max(20000).optional(),
  passageFormat:        z.string().max(100).optional(),
  imageUrl:             z.string().url().max(2000).optional(),
  imageRef:             z.string().max(255).optional(),
  passageType:          z.enum(["TEXT", "IMAGE", "TEXT_IMAGE"]).optional(),
  imageDisplayPosition: z.enum(["ABOVE", "MIDDLE", "BELOW", "BESIDE", "MAIN"]).optional(),
  section:              z.string().max(200).optional(),
  difficulty:           z.string().max(50).optional(),
  topic:                z.string().max(200).optional(),
  latexEnabled:         z.boolean().optional(),
  notes:                z.string().max(5000).optional(),
});

const updatePassageBodySchema = z.object({
  externalId:           z.string().max(100).nullable().optional(),
  title:                z.string().min(1).max(500).nullable().optional(),
  content:              z.string().min(1).max(20000).nullable().optional(),
  passageFormat:        z.string().max(100).nullable().optional(),
  imageUrl:             z.string().url().max(2000).nullable().optional(),
  imageRef:             z.string().max(255).nullable().optional(),
  passageType:          z.enum(["TEXT", "IMAGE", "TEXT_IMAGE"]).nullable().optional(),
  imageDisplayPosition: z.enum(["ABOVE", "MIDDLE", "BELOW", "BESIDE", "MAIN"]).nullable().optional(),
  section:              z.string().max(200).nullable().optional(),
  difficulty:           z.string().max(50).nullable().optional(),
  topic:                z.string().max(200).nullable().optional(),
  latexEnabled:         z.boolean().optional(),
  notes:                z.string().max(5000).nullable().optional(),
});

const listPassagesQuerySchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

const passageIdParamSchema = z.object({
  id: z.string().uuid(),
});

// ── Response schemas ──────────────────────────────────────────────────────────

const passageSchema = z.object({
  id:                   z.string().uuid(),
  externalId:           z.string().nullable(),
  title:                z.string().nullable(),
  content:              z.string().nullable(),
  passageFormat:        z.string().nullable(),
  imageUrl:             z.string().nullable(),
  imageRef:             z.string().nullable(),
  image:                z.object({
    fileName: z.string(),
    url: z.string().nullable(),
    altText: z.string().nullable(),
    caption: z.string().nullable(),
  }).nullable(),
  passageType:          z.enum(["TEXT", "IMAGE", "TEXT_IMAGE"]).nullable(),
  imageDisplayPosition: z.enum(["ABOVE", "MIDDLE", "BELOW", "BESIDE", "MAIN"]).nullable(),
  section:              z.string().nullable(),
  difficulty:           z.string().nullable(),
  topic:                z.string().nullable(),
  latexEnabled:         z.boolean(),
  notes:                z.string().nullable(),
  createdAt:            z.string().datetime(),
  updatedAt:            z.string().datetime(),
});

const relatedQuestionSchema = z.object({
  id:          z.string().uuid(),
  questionId:  z.string().nullable(),
  subjectId:   z.string().uuid(),
  topicId:     z.string().uuid(),
  passageId:   z.string().uuid().nullable(),
  type:        z.enum(["MCQ", "ESSAY"]),
  difficulty:  z.enum(["EASY", "MEDIUM", "HARD"]),
  status:      z.enum(["DRAFT", "PENDING_APPROVAL", "PUBLISHED"]),
  questionText: z.string(),
  createdAt:   z.string().datetime(),
  updatedAt:   z.string().datetime(),
});

const passageListItemSchema = passageSchema.extend({
  _count: z.object({
    questions: z.number(),
  }),
});

const passageDetailSchema = passageSchema.extend({
  _count: z.object({
    questions: z.number(),
  }),
  questions: z.array(relatedQuestionSchema),
});

const singlePassageResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data:    passageDetailSchema,
});

const paginatedPassagesResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data:    z.array(passageListItemSchema),
  meta:    z.object({
    page:       z.number(),
    limit:      z.number(),
    total:      z.number(),
    totalPages: z.number(),
  }),
});

const deletePassageResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

const importPassagesResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data:    z.object({
    total:   z.number(),
    created: z.number(),
    updated: z.number(),
    failed:  z.number(),
    errors:  z.array(z.object({ row: z.number(), reason: z.string() })),
  }),
});

// ── Exports ───────────────────────────────────────────────────────────────────

export const { schemas: passageSchemas, $ref: passageRef } = buildJsonSchemas({
  createPassageBodySchema,
  updatePassageBodySchema,
  listPassagesQuerySchema,
  passageIdParamSchema,
  passageSchema,
  relatedQuestionSchema,
  passageListItemSchema,
  passageDetailSchema,
  singlePassageResponseSchema,
  paginatedPassagesResponseSchema,
  deletePassageResponseSchema,
  importPassagesResponseSchema,
});

export type CreatePassageBody = z.infer<typeof createPassageBodySchema>;
export type UpdatePassageBody = z.infer<typeof updatePassageBodySchema>;
export type ListPassagesQuery = z.infer<typeof listPassagesQuerySchema>;
