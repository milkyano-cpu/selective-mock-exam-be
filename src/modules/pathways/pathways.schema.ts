import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Shared item schemas ─────────────────────────────────────────────────────

const topicSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  subjectId: z.string(),
});

const nodeProgressSchema = z.object({
  correctAnswers: z.number(),
  totalAttempts: z.number(),
  isUnlocked: z.boolean(),
  completedAt: z.string().nullable(),
});

const pathwayNodeItemSchema = z.object({
  id: z.string(),
  pathwayId: z.string(),
  topicId: z.string(),
  orderIndex: z.number(),
  topic: topicSummarySchema,
  progress: nodeProgressSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const pathwayItemSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  subjectId: z.string(),
  tutorId: z.string(),
  thresholdCorrect: z.number(),
  nodeCount: z.number(),
  subject: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const pathwayDetailSchema = pathwayItemSchema.extend({
  nodes: z.array(pathwayNodeItemSchema),
});

// ── Param schemas ────────────────────────────────────────────────────────────

const pathwayParamsSchema = z.object({
  id: z.string().uuid("Invalid pathway ID"),
});

const pathwayNodeParamsSchema = z.object({
  id: z.string().uuid("Invalid pathway ID"),
  nodeId: z.string().uuid("Invalid node ID"),
});

// ── Query schemas ────────────────────────────────────────────────────────────

const listPathwaysQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
});

// ── Request body schemas ─────────────────────────────────────────────────────

const createPathwayBodySchema = z.object({
  studentId: z.string().uuid("Invalid student ID"),
  subjectId: z.string().uuid("Invalid subject ID"),
  thresholdCorrect: z.coerce.number().int().min(1).max(20).default(3),
});

const addNodeBodySchema = z.object({
  topicId: z.string().uuid("Invalid topic ID"),
});

const reorderNodesBodySchema = z.object({
  order: z
    .array(
      z.object({
        nodeId: z.string().uuid("Invalid node ID"),
        orderIndex: z.number().int().min(0),
      })
    )
    .min(1, "Order must contain at least one item"),
});

const updateProgressBodySchema = z.object({
  correctAnswers: z.number().int().min(0),
  totalAttempts: z.number().int().min(1),
});

// ── Response schemas ─────────────────────────────────────────────────────────

const pathwayErrorResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

const listPathwaysResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(pathwayItemSchema),
});

const getPathwayResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: pathwayDetailSchema,
});

const createPathwayResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: pathwayDetailSchema,
});

const deletePathwayResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const addNodeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: pathwayNodeItemSchema,
});

const reorderNodesResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(pathwayNodeItemSchema),
});

const pathwayStartPracticeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    topicId: z.string(),
    nodeId: z.string(),
  }),
});

const updateProgressResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: nodeProgressSchema,
});

// ── Type exports ─────────────────────────────────────────────────────────────

export type ListPathwaysQuery = z.infer<typeof listPathwaysQuerySchema>;
export type CreatePathwayInput = z.infer<typeof createPathwayBodySchema>;
export type AddNodeInput = z.infer<typeof addNodeBodySchema>;
export type ReorderNodesInput = z.infer<typeof reorderNodesBodySchema>;
export type PathwayParams = z.infer<typeof pathwayParamsSchema>;
export type PathwayNodeParams = z.infer<typeof pathwayNodeParamsSchema>;
export type UpdateProgressInput = z.infer<typeof updateProgressBodySchema>;

export const { schemas: pathwaySchemas, $ref: pathwayRef } = buildJsonSchemas({
  pathwayParamsSchema,
  pathwayNodeParamsSchema,
  listPathwaysQuerySchema,
  createPathwayBodySchema,
  addNodeBodySchema,
  reorderNodesBodySchema,
  updateProgressBodySchema,
  listPathwaysResponseSchema,
  getPathwayResponseSchema,
  createPathwayResponseSchema,
  deletePathwayResponseSchema,
  addNodeResponseSchema,
  reorderNodesResponseSchema,
  pathwayStartPracticeResponseSchema,
  updateProgressResponseSchema,
  pathwayErrorResponseSchema,
});
