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
  bandLabel: z.string().min(1).max(100).optional(),
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
  highScoringIndicators: z.array(z.string().min(1)).optional(),
  lowScoringIndicators: z.array(z.string().min(1)).optional(),
  aiCalibrationNotes: z.array(z.string().min(1)).optional(),
  bandDescriptors: z.array(aiRubricBandDescriptorInputSchema).optional(),
});

const aiCalibrationNoteInputSchema = z.object({
  category: z.string().max(100).nullable().optional(),
  instruction: z.string().min(1).max(2000),
  sortOrder: z.number().int().min(0).optional(),
});

const createAiRubricBodySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  writingType: z.string().max(100).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  totalMaxScore: z.number().int().min(1),
  criteria: z.array(aiRubricCriterionInputSchema).optional(),
  bandDescriptors: z.array(aiRubricBandDescriptorInputSchema).optional(),
  calibrationNotes: z.array(aiCalibrationNoteInputSchema).optional(),
}).refine((value) => {
  if (!value.criteria || value.criteria.length === 0) return true;
  return value.criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0) === value.totalMaxScore;
}, {
  message: "Sum of criterion max scores must equal totalMaxScore",
  path: ["criteria"],
});

const updateAiRubricBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  writingType: z.string().max(100).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  totalMaxScore: z.number().int().min(1).optional(),
  criteria: z.array(aiRubricCriterionInputSchema).optional(),
  bandDescriptors: z.array(aiRubricBandDescriptorInputSchema).optional(),
  calibrationNotes: z.array(aiCalibrationNoteInputSchema).optional(),
}).refine((value) => {
  if (!value.criteria || value.criteria.length === 0 || value.totalMaxScore === undefined) return true;
  return value.criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0) === value.totalMaxScore;
}, {
  message: "Sum of criterion max scores must equal totalMaxScore",
  path: ["criteria"],
});

const bandDescriptorSchema = z.object({
  id: z.string().uuid(),
  aiRubricId: z.string(),
  bandLabel: z.string(),
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
  highScoringIndicators: z.array(z.string()),
  lowScoringIndicators: z.array(z.string()),
  aiCalibrationNotes: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const calibrationNoteSchema = z.object({
  id: z.string().uuid(),
  aiRubricId: z.string(),
  category: z.string().nullable(),
  instruction: z.string(),
  sortOrder: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const aiRubricSchema = z.object({
  id: z.string(),
  name: z.string(),
  writingType: z.string().nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  totalMaxScore: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const aiRubricDetailSchema = aiRubricSchema.extend({
  criteria: z.array(criterionSchema),
  bandDescriptors: z.array(bandDescriptorSchema),
  calibrationNotes: z.array(calibrationNoteSchema),
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

// ── Per-entity child params & responses ──────────────────────────────────────

const rubricChildParamsSchema = z.object({
  rubricId: z.string().min(1).max(100),
  childId: z.string().uuid(),
});

const rubricIdOnlyParamsSchema = z.object({
  rubricId: z.string().min(1).max(100),
});

const updateCriterionInputSchema = aiRubricCriterionInputSchema.partial();
const updateBandInputSchema = z.object({
  bandLabel: z.string().min(1).max(100).optional(),
  scoreMin: z.number().int().min(0).optional(),
  scoreMax: z.number().int().min(0).optional(),
  descriptor: z.string().min(1).max(2000).optional(),
});
const updateCalibrationNoteInputSchema = aiCalibrationNoteInputSchema.partial();

const singleCriterionResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: criterionSchema,
});
const singleBandResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: bandDescriptorSchema,
});
const singleCalibrationNoteResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: calibrationNoteSchema,
});

export const { schemas: aiRubricSchemas, $ref: aiRubricRef } = buildJsonSchemas({
  listAiRubricsQuerySchema,
  aiRubricIdParamSchema,
  aiRubricBandDescriptorInputSchema,
  aiRubricCriterionInputSchema,
  aiCalibrationNoteInputSchema,
  createAiRubricBodySchema,
  updateAiRubricBodySchema,
  bandDescriptorSchema,
  criterionSchema,
  calibrationNoteSchema,
  aiRubricSchema,
  aiRubricDetailSchema,
  paginatedAiRubricsResponseSchema,
  singleAiRubricResponseSchema,
  importAiRubricsResponseSchema,
  actionResponseSchema,
  rubricChildParamsSchema,
  rubricIdOnlyParamsSchema,
  updateCriterionInputSchema,
  updateBandInputSchema,
  updateCalibrationNoteInputSchema,
  singleCriterionResponseSchema,
  singleBandResponseSchema,
  singleCalibrationNoteResponseSchema,
});

export type ListAiRubricsQuery = z.infer<typeof listAiRubricsQuerySchema>;
export type CreateAiRubricBody = z.infer<typeof createAiRubricBodySchema>;
export type UpdateAiRubricBody = z.infer<typeof updateAiRubricBodySchema>;
export type RubricChildParams = z.infer<typeof rubricChildParamsSchema>;
export type RubricIdOnlyParams = z.infer<typeof rubricIdOnlyParamsSchema>;
export type CreateCriterionInput = z.infer<typeof aiRubricCriterionInputSchema>;
export type UpdateCriterionInput = z.infer<typeof updateCriterionInputSchema>;
export type CreateBandInput = z.infer<typeof aiRubricBandDescriptorInputSchema>;
export type UpdateBandInput = z.infer<typeof updateBandInputSchema>;
export type CreateCalibrationNoteInput = z.infer<typeof aiCalibrationNoteInputSchema>;
export type UpdateCalibrationNoteInput = z.infer<typeof updateCalibrationNoteInputSchema>;
