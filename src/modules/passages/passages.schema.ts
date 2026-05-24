import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const passageFormatSchema = z.enum(["text", "poem", "article", "visual_text", "image_only"]);
const passageTypeSchema = z.enum(["comprehension", "poem", "visual"]);
const difficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
const imageDisplayPositionSchema = z.enum(["above", "below", "inline"]);

// ── Request schemas ───────────────────────────────────────────────────────────

const createPassageBodySchema = z.object({
  title:                z.string().max(500).optional(),
  text:                 z.string().min(1).max(20000).optional(),
  passageFormat:        passageFormatSchema,
  imageRef:             z.string().max(255).optional(),
  imageAltText:         z.string().max(500).optional(),
  imageCaption:         z.string().max(1000).optional(),
  passageType:          passageTypeSchema,
  imageDisplayPosition: imageDisplayPositionSchema.optional(),
  subjectId:            z.string().uuid(),
  topicId:              z.string().uuid(),
  difficulty:           difficultySchema,
  latexEnabled:         z.boolean().optional(),
  notes:                z.string().max(5000).optional(),
});

const updatePassageBodySchema = z.object({
  title:                z.string().max(500).nullable().optional(),
  text:                 z.string().min(1).max(20000).nullable().optional(),
  passageFormat:        passageFormatSchema.optional(),
  imageRef:             z.string().max(255).nullable().optional(),
  imageAltText:         z.string().max(500).nullable().optional(),
  imageCaption:         z.string().max(1000).nullable().optional(),
  passageType:          passageTypeSchema.optional(),
  imageDisplayPosition: imageDisplayPositionSchema.nullable().optional(),
  subjectId:            z.string().uuid().optional(),
  topicId:              z.string().uuid().optional(),
  difficulty:           difficultySchema.optional(),
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
  passageId:            z.string(),
  title:                z.string().nullable(),
  text:                 z.string().nullable(),
  passageFormat:        passageFormatSchema,
  imageRef:             z.string().nullable(),
  imageAltText:         z.string().nullable(),
  imageCaption:         z.string().nullable(),
  image:                z.object({
    fileName: z.string(),
    url: z.string().nullable(),
    altText: z.string().nullable(),
    caption: z.string().nullable(),
  }).nullable(),
  passageType:          passageTypeSchema,
  imageDisplayPosition: imageDisplayPositionSchema.nullable(),
  subjectId:            z.string().uuid(),
  subject:              z.object({ id: z.string().uuid(), name: z.string() }),
  topicId:              z.string().uuid(),
  topic:                z.object({ id: z.string().uuid(), name: z.string() }),
  difficulty:           difficultySchema,
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
