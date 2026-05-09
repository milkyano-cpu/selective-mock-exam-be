import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const listRubricsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  activeOnly: z.coerce.boolean().default(true),
});

const rubricIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});

const rubricBandDescriptorInputSchema = z.object({
  scoreMin: z.number().int().min(0),
  scoreMax: z.number().int().min(0),
  descriptor: z.string().min(1).max(2000),
}).refine((value) => value.scoreMax >= value.scoreMin, {
  message: "scoreMax must be greater than or equal to scoreMin",
  path: ["scoreMax"],
});

const rubricCriterionInputSchema = z.object({
  criterionName: z.string().min(1).max(255),
  criterionDescription: z.string().min(1).max(2000),
  maxScore: z.number().int().min(1),
  sortOrder: z.number().int().min(0).optional(),
  bandDescriptors: z.array(rubricBandDescriptorInputSchema).optional(),
});

const createRubricBodySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  writingType: z.string().max(100).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  totalMaxScore: z.number().int().min(1),
  criteria: z.array(rubricCriterionInputSchema).optional(),
}).refine((value) => {
  if (!value.criteria || value.criteria.length === 0) return true;
  return value.criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0) === value.totalMaxScore;
}, {
  message: "Sum of criterion max scores must equal totalMaxScore",
  path: ["criteria"],
});

const updateRubricBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  writingType: z.string().max(100).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  totalMaxScore: z.number().int().min(1).optional(),
  criteria: z.array(rubricCriterionInputSchema).optional(),
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
  rubricId: z.string(),
  criterionName: z.string(),
  criterionDescription: z.string(),
  maxScore: z.number(),
  sortOrder: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  bandDescriptors: z.array(bandDescriptorSchema).optional(),
});

const rubricSchema = z.object({
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

const rubricDetailSchema = rubricSchema.extend({
  criteria: z.array(criterionSchema),
});

const paginatedRubricsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.array(rubricSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const singleRubricResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: rubricDetailSchema,
});

const importRubricsResponseSchema = z.object({
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

export const { schemas: rubricSchemas, $ref: rubricRef } = buildJsonSchemas({
  listRubricsQuerySchema,
  rubricIdParamSchema,
  rubricBandDescriptorInputSchema,
  rubricCriterionInputSchema,
  createRubricBodySchema,
  updateRubricBodySchema,
  bandDescriptorSchema,
  criterionSchema,
  rubricSchema,
  rubricDetailSchema,
  paginatedRubricsResponseSchema,
  singleRubricResponseSchema,
  importRubricsResponseSchema,
  actionResponseSchema,
});

export type ListRubricsQuery = z.infer<typeof listRubricsQuerySchema>;
export type CreateRubricBody = z.infer<typeof createRubricBodySchema>;
export type UpdateRubricBody = z.infer<typeof updateRubricBodySchema>;
