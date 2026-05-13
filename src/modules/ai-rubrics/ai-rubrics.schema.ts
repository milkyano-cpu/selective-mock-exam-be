import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const listAiRubricsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  activeOnly: z.coerce.boolean().default(true),
});

const aiRubricIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});

const aiRubricBandDescriptorInputSchema = z.object({
  scoreMin: z.number().int().min(0),
  scoreMax: z.number().int().min(0),
  descriptor: z.string().min(1).max(2000),
}).refine((value) => value.scoreMax >= value.scoreMin, {
  message: "scoreMax must be greater than or equal to scoreMin",
  path: ["scoreMax"],
});

const aiRubricCriterionInputSchema = z.object({
  criterionName: z.string().min(1).max(255),
  criterionDescription: z.string().min(1).max(2000),
  maxScore: z.number().int().min(1),
  sortOrder: z.number().int().min(0).optional(),
  bandDescriptors: z.array(aiRubricBandDescriptorInputSchema).optional(),
});

const createAiRubricBodySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  writingType: z.string().max(100).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  totalMaxScore: z.number().int().min(1),
  criteria: z.array(aiRubricCriterionInputSchema).optional(),
}).refine((value) => {
  if (!value.criteria || value.criteria.length === 0) return true;
  return value.criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0) === value.totalMaxScore;
}, {
  message: "Sum of criterion max scores must equal totalMaxScore",
  path: ["criteria"],
});

const updateAiRubricBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  writingType: z.string().max(100).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  totalMaxScore: z.number().int().min(1).optional(),
  criteria: z.array(aiRubricCriterionInputSchema).optional(),
}).refine((value) => {
  if (!value.criteria || value.criteria.length === 0 || value.totalMaxScore === undefined) return true;
  return value.criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0) === value.totalMaxScore;
}, {
  message: "Sum of criterion max scores must equal totalMaxScore",
  path: ["criteria"],
});

const bandDescriptorSchema = z.object({
  id: z.string().uuid(),
  criterionId: z.string().uuid(),
  scoreMin: z.number(),
  scoreMax: z.number(),
  descriptor: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const criterionSchema = z.object({
  id: z.string().uuid(),
  aiRubricId: z.string(),
  criterionName: z.string(),
  criterionDescription: z.string(),
  maxScore: z.number(),
  sortOrder: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  bandDescriptors: z.array(bandDescriptorSchema).optional(),
});

const aiRubricSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  writingType: z.string().nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  totalMaxScore: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const aiRubricDetailSchema = aiRubricSchema.extend({
  criteria: z.array(criterionSchema),
});

const paginatedAiRubricsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.array(aiRubricSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const singleAiRubricResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: aiRubricDetailSchema,
});

const importAiRubricsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    total: z.number(),
    imported: z.number(),
    failed: z.number(),
    errors: z.array(z.object({ row: z.number(), reason: z.string() })),
  }),
});

const actionResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

export const { schemas: aiRubricSchemas, $ref: aiRubricRef } = buildJsonSchemas({
  listAiRubricsQuerySchema,
  aiRubricIdParamSchema,
  aiRubricBandDescriptorInputSchema,
  aiRubricCriterionInputSchema,
  createAiRubricBodySchema,
  updateAiRubricBodySchema,
  bandDescriptorSchema,
  criterionSchema,
  aiRubricSchema,
  aiRubricDetailSchema,
  paginatedAiRubricsResponseSchema,
  singleAiRubricResponseSchema,
  importAiRubricsResponseSchema,
  actionResponseSchema,
});

export type ListAiRubricsQuery = z.infer<typeof listAiRubricsQuerySchema>;
export type CreateAiRubricBody = z.infer<typeof createAiRubricBodySchema>;
export type UpdateAiRubricBody = z.infer<typeof updateAiRubricBodySchema>;
