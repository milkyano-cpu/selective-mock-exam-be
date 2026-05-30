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
  questionCount: z.number(),
  progress: nodeProgressSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const pathwayItemSchema = z.object({
  id: z.string(),
  planId: z.string(),
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

// ── Node question (curation) schemas ─────────────────────────────────────────

const mcqOptionSchema = z.object({
  key: z.string(),
  text: z.string(),
});

const nodeQuestionContentSchema = z.object({
  id: z.string(),
  type: z.string(),
  difficulty: z.string(),
  status: z.string(),
  questionText: z.string(),
  latexEnabled: z.boolean(),
  options: z.array(mcqOptionSchema).nullable(),
  correctAnswer: z.string().nullable(),
  explanation: z.string().nullable(),
  topicId: z.string(),
  topic: z.object({ id: z.string(), name: z.string() }),
});

const nodeQuestionItemSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  questionId: z.string(),
  orderIndex: z.number(),
  question: nodeQuestionContentSchema,
});

// ── Param schemas ────────────────────────────────────────────────────────────

const pathwayParamsSchema = z.object({
  id: z.string().uuid("Invalid pathway ID"),
});

const pathwayNodeParamsSchema = z.object({
  id: z.string().uuid("Invalid pathway ID"),
  nodeId: z.string().uuid("Invalid node ID"),
});

const nodeOnlyParamsSchema = z.object({
  nodeId: z.string().uuid("Invalid node ID"),
});

const nodeQuestionParamsSchema = z.object({
  nodeId: z.string().uuid("Invalid node ID"),
  questionId: z.string().uuid("Invalid question ID"),
});

// ── Query schemas ────────────────────────────────────────────────────────────

const listPathwaysQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
});

// ── Request body schemas ─────────────────────────────────────────────────────

const createPathwayBodySchema = z.object({
  planId: z.string().uuid("Invalid plan ID"),
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

const addNodeQuestionsBodySchema = z.object({
  questionIds: z
    .array(z.string().uuid("Invalid question ID"))
    .min(1, "Provide at least one question"),
});

const reorderNodeQuestionsBodySchema = z.object({
  orderedQuestionIds: z
    .array(z.string().uuid("Invalid question ID"))
    .min(1, "Provide at least one question"),
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

const nodeQuestionsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(nodeQuestionItemSchema),
});

// ── Type exports ─────────────────────────────────────────────────────────────

export type ListPathwaysQuery = z.infer<typeof listPathwaysQuerySchema>;
export type CreatePathwayInput = z.infer<typeof createPathwayBodySchema>;
export type AddNodeInput = z.infer<typeof addNodeBodySchema>;
export type ReorderNodesInput = z.infer<typeof reorderNodesBodySchema>;
export type PathwayParams = z.infer<typeof pathwayParamsSchema>;
export type PathwayNodeParams = z.infer<typeof pathwayNodeParamsSchema>;
export type NodeOnlyParams = z.infer<typeof nodeOnlyParamsSchema>;
export type NodeQuestionParams = z.infer<typeof nodeQuestionParamsSchema>;
export type UpdateProgressInput = z.infer<typeof updateProgressBodySchema>;
export type AddNodeQuestionsInput = z.infer<typeof addNodeQuestionsBodySchema>;
export type ReorderNodeQuestionsInput = z.infer<typeof reorderNodeQuestionsBodySchema>;

export const { schemas: pathwaySchemas, $ref: pathwayRef } = buildJsonSchemas({
  pathwayParamsSchema,
  pathwayNodeParamsSchema,
  nodeOnlyParamsSchema,
  nodeQuestionParamsSchema,
  listPathwaysQuerySchema,
  createPathwayBodySchema,
  addNodeBodySchema,
  reorderNodesBodySchema,
  updateProgressBodySchema,
  addNodeQuestionsBodySchema,
  reorderNodeQuestionsBodySchema,
  listPathwaysResponseSchema,
  getPathwayResponseSchema,
  createPathwayResponseSchema,
  deletePathwayResponseSchema,
  addNodeResponseSchema,
  reorderNodesResponseSchema,
  pathwayStartPracticeResponseSchema,
  updateProgressResponseSchema,
  nodeQuestionsResponseSchema,
  pathwayErrorResponseSchema,
});
