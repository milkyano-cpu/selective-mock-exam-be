import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Shared field schemas ────────────────────────────────────

const subjectItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  questionCode: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const topicItemSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const paginationMetaSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

// ── Common response schemas ─────────────────────────────────

const subjectForbiddenResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

const subjectNotFoundResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

// ── Subject schemas ─────────────────────────────────────────

const subjectParamsSchema = z.object({
  subjectId: z.string().uuid("Invalid subject ID"),
});

const createSubjectBodySchema = z.object({
  name: z
    .string({ error: "Subject name is required" })
    .min(1, "Subject name must not be empty")
    .max(100, "Subject name must be at most 100 characters"),
  questionCode: z
    .string({ error: "Question code is required" })
    .min(1, "Question code must not be empty")
    .max(10, "Question code must be at most 10 characters"),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .nullable()
    .optional(),
});

const updateSubjectBodySchema = z.object({
  name: z
    .string()
    .min(1, "Subject name must not be empty")
    .max(100, "Subject name must be at most 100 characters")
    .optional(),
  questionCode: z
    .string()
    .min(1, "Question code must not be empty")
    .max(10, "Question code must be at most 10 characters")
    .optional(),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .nullable()
    .optional(),
});

const listSubjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z.enum(["name", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  publishedOnly: z.coerce.boolean().optional(),
});

const listSubjectsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(subjectItemSchema.extend({ _count: z.object({ topics: z.number(), questions: z.number() }) })),
  meta: paginationMetaSchema,
});

const getSubjectResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: subjectItemSchema.extend({
    topics: z.array(topicItemSchema),
    _count: z.object({ questions: z.number() }),
  }),
});

const createSubjectResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: subjectItemSchema,
});

const updateSubjectResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: subjectItemSchema,
});

const deleteSubjectResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// ── Topic schemas ───────────────────────────────────────────

const topicParamsSchema = z.object({
  subjectId: z.string().uuid("Invalid subject ID"),
  topicId: z.string().uuid("Invalid topic ID"),
});

const createTopicBodySchema = z.object({
  name: z
    .string({ error: "Topic name is required" })
    .min(1, "Topic name must not be empty")
    .max(150, "Topic name must be at most 150 characters"),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .nullable()
    .optional(),
});

const ensureSubjectTopicsBodySchema = z.object({
  subject: createSubjectBodySchema,
  topics: z
    .array(createTopicBodySchema)
    .max(200, "At most 200 topics can be ensured at once")
    .default([]),
});

const ensureSubjectTopicsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    subject: subjectItemSchema,
    topics: z.array(topicItemSchema),
  }),
});

const updateTopicBodySchema = z.object({
  name: z
    .string()
    .min(1, "Topic name must not be empty")
    .max(150, "Topic name must be at most 150 characters")
    .optional(),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .nullable()
    .optional(),
});

const listTopicsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z.enum(["name", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  publishedOnly: z.coerce.boolean().optional(),
});

const listTopicsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(topicItemSchema.extend({ _count: z.object({ questions: z.number() }) })),
  meta: paginationMetaSchema,
});

const getTopicResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: topicItemSchema.extend({ _count: z.object({ questions: z.number() }) }),
});

const createTopicResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: topicItemSchema,
});

const updateTopicResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: topicItemSchema,
});

const deleteTopicResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// ── Exports ─────────────────────────────────────────────────

export type SubjectParams = z.infer<typeof subjectParamsSchema>;
export type CreateSubjectInput = z.infer<typeof createSubjectBodySchema>;
export type EnsureSubjectTopicsInput = z.infer<typeof ensureSubjectTopicsBodySchema>;
export type UpdateSubjectInput = z.infer<typeof updateSubjectBodySchema>;
export type ListSubjectsQuery = z.infer<typeof listSubjectsQuerySchema>;
export type TopicParams = z.infer<typeof topicParamsSchema>;
export type CreateTopicInput = z.infer<typeof createTopicBodySchema>;
export type UpdateTopicInput = z.infer<typeof updateTopicBodySchema>;
export type ListTopicsQuery = z.infer<typeof listTopicsQuerySchema>;

export const { schemas: subjectSchemas, $ref: subjectRef } = buildJsonSchemas({
  subjectParamsSchema,
  createSubjectBodySchema,
  updateSubjectBodySchema,
  listSubjectsQuerySchema,
  listSubjectsResponseSchema,
  getSubjectResponseSchema,
  createSubjectResponseSchema,
  ensureSubjectTopicsBodySchema,
  ensureSubjectTopicsResponseSchema,
  updateSubjectResponseSchema,
  deleteSubjectResponseSchema,
  topicParamsSchema,
  createTopicBodySchema,
  updateTopicBodySchema,
  listTopicsQuerySchema,
  listTopicsResponseSchema,
  getTopicResponseSchema,
  createTopicResponseSchema,
  updateTopicResponseSchema,
  deleteTopicResponseSchema,
  subjectForbiddenResponseSchema,
  subjectNotFoundResponseSchema,
});
