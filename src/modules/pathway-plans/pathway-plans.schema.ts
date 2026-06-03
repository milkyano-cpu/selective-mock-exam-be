import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Shared item schemas ──────────────────────────────────────────────────────

const planSubjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
});

// A pathway as summarised inside a plan list/detail
const planPathwaySummarySchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  thresholdCorrect: z.number(),
  subject: planSubjectSummarySchema,
  nodeCount: z.number(),
  completedNodeCount: z.number(),
});

const planListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  tutorId: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  tutorName: z.string().nullable(),
  dueDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  isPublished: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  subjects: z.array(planSubjectSummarySchema),
  totalNodes: z.number(),
  completedNodes: z.number(),
  progressPercent: z.number(),
  isComplete: z.boolean(),
});

const planDetailSchema = planListItemSchema.extend({
  pathways: z.array(planPathwaySummarySchema),
});

// ── Param schemas ────────────────────────────────────────────────────────────

const planParamsSchema = z.object({
  id: z.string().uuid("Invalid plan ID"),
});

const planPathwayParamsSchema = z.object({
  id: z.string().uuid("Invalid plan ID"),
  pathwayId: z.string().uuid("Invalid pathway ID"),
});

// ── Query schemas ────────────────────────────────────────────────────────────

const listPlansQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Request body schemas ─────────────────────────────────────────────────────

const createPlanBodySchema = z.object({
  name: z.string().trim().min(1, "Plan name is required").max(120),
  studentId: z.string().uuid("Invalid student ID"),
  dueDate: z.string().datetime({ offset: true }).optional(),
});

const updatePlanBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((data) => data.name !== undefined || data.dueDate !== undefined, {
    message: "Provide at least one field to update",
  });

const addPlanPathwayBodySchema = z.object({
  subjectId: z.string().uuid("Invalid subject ID"),
  thresholdCorrect: z.coerce.number().int().min(1).max(20).default(3),
});

// ── Response schemas ─────────────────────────────────────────────────────────

const planErrorResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

const paginationMetaSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

const listPlansResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(planListItemSchema),
  meta: paginationMetaSchema,
});

const planDetailResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: planDetailSchema,
});

const createPlanResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: planListItemSchema,
});

const deletePlanResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// A created/added pathway echoes the pathways module detail shape loosely;
// keep it permissive here so we do not duplicate that schema.
const addPlanPathwayResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    id: z.string(),
    planId: z.string(),
    studentId: z.string(),
    subjectId: z.string(),
    tutorId: z.string(),
    thresholdCorrect: z.number(),
    nodeCount: z.number(),
    subject: planSubjectSummarySchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

// ── Type exports ─────────────────────────────────────────────────────────────

export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;
export type CreatePlanInput = z.infer<typeof createPlanBodySchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanBodySchema>;
export type AddPlanPathwayInput = z.infer<typeof addPlanPathwayBodySchema>;
export type PlanParams = z.infer<typeof planParamsSchema>;
export type PlanPathwayParams = z.infer<typeof planPathwayParamsSchema>;

export const { schemas: pathwayPlanSchemas, $ref: pathwayPlanRef } = buildJsonSchemas({
  planParamsSchema,
  planPathwayParamsSchema,
  listPlansQuerySchema,
  createPlanBodySchema,
  updatePlanBodySchema,
  addPlanPathwayBodySchema,
  listPlansResponseSchema,
  planDetailResponseSchema,
  createPlanResponseSchema,
  deletePlanResponseSchema,
  addPlanPathwayResponseSchema,
  planErrorResponseSchema,
});
