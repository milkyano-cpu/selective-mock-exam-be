import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Shared sub-schemas ────────────────────────────────────────────────────────

const MCQ_KEYS = ["A", "B", "C", "D", "E"] as const;

const mcqOptionSchema = z.object({
  key: z.enum(MCQ_KEYS),
  text: z.string().min(1),
});

const mcqOptionsSchema = z
  .array(mcqOptionSchema)
  .length(5, "MCQ questions must have exactly 5 options (A–E)")
  .refine(
    (opts) => {
      const keys = opts.map((o) => o.key);
      return MCQ_KEYS.every((k) => keys.includes(k));
    },
    {
      message: "MCQ options must include all keys A, B, C, D, and E",
    }
  );

const questionMarkingTypeSchema = z.enum(["AUTO", "AI", "MANUAL"]);
// Writing type is validated against the AiRubricWritingType table at the service layer
const essayWritingTypeSchema = z
  .string()
  .trim()
  .min(1, "writingType must not be empty")
  .max(50, "writingType must be at most 50 characters")
  .regex(/^[A-Z0-9_]+$/, "writingType must be uppercase letters, digits, or underscore");

// ── Request schemas ───────────────────────────────────────────────────────────

const createQuestionBodySchema = z
  .object({
    subjectId: z.string().uuid(),
    topicId: z.string().uuid(),
    passageId: z.string().uuid().optional(),
    aiRubricId: z.string().max(100).nullable().optional(),
    questionNumber: z.number().int().min(1).optional(),
    type: z.enum(["MCQ", "ESSAY"]),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
    questionText: z.string().min(1).max(5000),
    writingType: essayWritingTypeSchema.optional(),
    promptText: z.string().min(1).max(10000).optional(),
    markingGuide: z.string().max(10000).nullable().optional(),
    latexEnabled: z.boolean().optional().default(false),
    adaptiveTags: z.array(z.string().min(1)).default([]),
    skillTags: z.array(z.string().min(1)).default([]),
    markingType: questionMarkingTypeSchema.optional(),
    maxMarks: z.number().int().min(1).optional(),
    options: mcqOptionsSchema.optional(),
    correctAnswer: z.string().optional(),
    explanation: z.string().max(5000).optional(),
    timeLimitSeconds: z.number().int().min(5).max(3600).nullable().optional(),
    imageRefs: z.array(z.string().min(1)).optional(),
    subtopics: z.array(z.string().min(1)).default([]),
    notes: z.string().max(2000).optional(),
    questionId: z.string().max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "MCQ") {
      if (!data.options) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "options are required for MCQ questions" });
      }
      if (!data.correctAnswer) {
        ctx.addIssue({ code: "custom", path: ["correctAnswer"], message: "correctAnswer is required for MCQ questions" });
      } else if (!MCQ_KEYS.includes(data.correctAnswer as typeof MCQ_KEYS[number])) {
        ctx.addIssue({ code: "custom", path: ["correctAnswer"], message: "correctAnswer must be A, B, C, D, or E for MCQ questions" });
      } else if (data.options) {
        const optionKeys = data.options.map((o) => o.key);
        if (!optionKeys.includes(data.correctAnswer as typeof MCQ_KEYS[number])) {
          ctx.addIssue({ code: "custom", path: ["correctAnswer"], message: "correctAnswer must match one of the provided option keys" });
        }
      }
    }
    if (data.type === "ESSAY" && data.options !== undefined) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "options must not be provided for ESSAY questions" });
    }
    if (data.type === "ESSAY" && data.passageId) {
      ctx.addIssue({ code: "custom", path: ["passageId"], message: "ESSAY questions must not use a passage" });
    }
    if (data.type === "ESSAY") {
      if (!data.writingType) ctx.addIssue({ code: "custom", path: ["writingType"], message: "writingType is required for ESSAY questions" });
      if (!data.promptText?.trim()) ctx.addIssue({ code: "custom", path: ["promptText"], message: "promptText is required for ESSAY questions" });
      if (data.markingType !== "MANUAL" && !data.aiRubricId) {
        ctx.addIssue({ code: "custom", path: ["aiRubricId"], message: "aiRubricId is required for ESSAY questions graded by AI" });
      }
    }
    if (data.type === "MCQ" && data.aiRubricId) {
      ctx.addIssue({ code: "custom", path: ["aiRubricId"], message: "MCQ questions must not use a aiRubric" });
    }
    if (data.type === "MCQ" && data.markingType !== undefined && data.markingType !== "AUTO") {
      ctx.addIssue({ code: "custom", path: ["markingType"], message: "MCQ questions must use AUTO marking" });
    }
    if (data.type === "ESSAY" && data.markingType === "AUTO") {
      ctx.addIssue({ code: "custom", path: ["markingType"], message: "ESSAY questions must use AI or MANUAL marking" });
    }
  });

const updateQuestionBodySchema = z
  .object({
    subjectId: z.string().uuid().optional(),
    topicId: z.string().uuid().optional(),
    passageId: z.string().uuid().nullable().optional(),
    aiRubricId: z.string().max(100).nullable().optional(),
    questionNumber: z.number().int().min(1).nullable().optional(),
    type: z.enum(["MCQ", "ESSAY"]).optional(),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
    questionText: z.string().min(1).max(5000).optional(),
    writingType: essayWritingTypeSchema.nullable().optional(),
    promptText: z.string().min(1).max(10000).nullable().optional(),
    markingGuide: z.string().max(10000).nullable().optional(),
    latexEnabled: z.boolean().optional(),
    adaptiveTags: z.array(z.string().min(1)).optional(),
    skillTags: z.array(z.string().min(1)).optional(),
    markingType: questionMarkingTypeSchema.optional(),
    maxMarks: z.number().int().min(1).optional(),
    options: mcqOptionsSchema.optional(),
    correctAnswer: z.string().optional(),
    explanation: z.string().max(5000).optional(),
    timeLimitSeconds: z.number().int().min(5).max(3600).optional(),
    imageRefs: z.array(z.string().min(1)).optional(),
    subtopics: z.array(z.string().min(1)).optional(),
    notes: z.string().max(2000).nullable().optional(),
    questionId: z.string().max(100).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "MCQ") {
      if (data.correctAnswer !== undefined && !MCQ_KEYS.includes(data.correctAnswer as typeof MCQ_KEYS[number])) {
        ctx.addIssue({ code: "custom", path: ["correctAnswer"], message: "correctAnswer must be A, B, C, D, or E for MCQ questions" });
      }
    }
    if (data.type === "ESSAY" && data.options !== undefined) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "options must not be provided for ESSAY questions" });
    }
    if (data.type === "ESSAY" && data.passageId) {
      ctx.addIssue({ code: "custom", path: ["passageId"], message: "ESSAY questions must not use a passage" });
    }
    if (data.type === "MCQ" && data.aiRubricId) {
      ctx.addIssue({ code: "custom", path: ["aiRubricId"], message: "MCQ questions must not use a aiRubric" });
    }
    if (data.type === "MCQ" && data.markingType !== undefined && data.markingType !== "AUTO") {
      ctx.addIssue({ code: "custom", path: ["markingType"], message: "MCQ questions must use AUTO marking" });
    }
    if (data.type === "ESSAY" && data.markingType === "AUTO") {
      ctx.addIssue({ code: "custom", path: ["markingType"], message: "ESSAY questions must use AI or MANUAL marking" });
    }
  });

const listQuestionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  subjectId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  passageId: z.string().uuid().optional(),
  type: z.enum(["MCQ", "ESSAY"]).optional(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "PUBLISHED"]).optional(),
  hasImage: z.coerce.boolean().optional(),
});

const nextQuestionIdQuerySchema = z.object({
  subjectId: z.string().uuid(),
});

const nextQuestionIdResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    questionId: z.string(),
    prefix: z.string(),
    nextNumber: z.number(),
  }),
});

const rejectQuestionBodySchema = z.object({
  rejectionNote: z.string().min(1).max(1000),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

// ── Response schemas ──────────────────────────────────────────────────────────

const questionSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().nullable(),
  questionNumber: z.number().nullable(),
  subjectId: z.string().uuid(),
  topicId: z.string().uuid(),
  subjectName: z.string(),
  topicName: z.string(),
  tutorId: z.string().uuid(),
  passageId: z.string().uuid().nullable(),
  aiRubricId: z.string().nullable(),
  aiRubric: z.object({
    id: z.string(),
    name: z.string(),
    totalMaxScore: z.number(),
  }).nullable(),
  type: z.enum(["MCQ", "ESSAY"]),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  questionText: z.string(),
  writingType: z.string().nullable(),
  promptText: z.string().nullable(),
  markingGuide: z.string().nullable(),
  latexEnabled: z.boolean(),
  adaptiveTags: z.array(z.string()),
  skillTags: z.array(z.string()),
  markingType: questionMarkingTypeSchema,
  maxMarks: z.number(),
  options: z.any().nullable(),
  correctAnswer: z.string(),
  explanation: z.string().nullable(),
  timeLimitSeconds: z.number().nullable(),
  imageRefs: z.array(z.string()),
  images: z.array(z.object({
    fileName: z.string(),
    url: z.string().nullable(),
    altText: z.string().nullable(),
    caption: z.string().nullable(),
  })),
  subtopics: z.array(z.string()),
  notes: z.string().nullable(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "PUBLISHED"]),
  rejectionNote: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const singleQuestionResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: questionSchema,
});

const paginatedQuestionsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.array(questionSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const unresolvedRowDataSchema = z.object({
  questionId: z.string(),
  questionNumber: z.number().nullable(),
  subjectName: z.string(),
  topicName: z.string(),
  type: z.string(),
  difficulty: z.string(),
  questionText: z.string(),
  writingType: z.string().nullable(),
  promptText: z.string().nullable(),
  markingGuide: z.string().nullable(),
  optionA: z.string(),
  optionB: z.string(),
  optionC: z.string(),
  optionD: z.string(),
  optionE: z.string(),
  correctAnswer: z.string(),
  explanation: z.string().nullable(),
  timeLimitSeconds: z.number().nullable(),
  imageRefs: z.array(z.string()),
  passageExternalId: z.string().nullable(),
  aiRubricId: z.string().nullable(),
  subtopics: z.array(z.string()),
  notes: z.string().nullable(),
  latexEnabled: z.boolean().optional(),
  adaptiveTags: z.array(z.string()).default([]),
  skillTags: z.array(z.string()).default([]),
  markingType: questionMarkingTypeSchema,
  maxMarks: z.number(),
});

const unresolvedRowSchema = z.object({
  rowNumber: z.number(),
  sectionName: z.string(),
  topicName: z.string(),
  reason: z.enum(["SUBJECT_NOT_FOUND", "TOPIC_NOT_FOUND"]),
  resolvedSubjectId: z.string().uuid().optional(),
  resolvedTopicId: z.string().uuid().optional(),
  rowData: unresolvedRowDataSchema,
});

const importedQuestionItemSchema = z.object({
  rowNumber: z.number(),
  question: questionSchema,
});

const bulkImportResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    total: z.number(),
    created: z.number(),
    skipped: z.number(),
    failed: z.number(),
    unresolved: z.number(),
    errors: z.array(z.object({ row: z.number(), reason: z.string() })),
    skippedErrors: z.array(z.object({ row: z.number(), reason: z.string() })),
    unresolvedRows: z.array(unresolvedRowSchema),
    createdQuestions: z.array(importedQuestionItemSchema),
  }),
});

const resolveImportBodySchema = z.object({
  rows: z.array(unresolvedRowSchema).min(1),
});

const resolveImportResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    saved: z.number(),
    stillUnresolved: z.array(unresolvedRowSchema),
    createdQuestions: z.array(importedQuestionItemSchema),
  }),
});

const bulkSubmitBodySchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1, "At least one question ID is required")
    .max(500, "At most 500 questions can be submitted at once"),
});

const bulkSubmitResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    submitted: z.number(),
    failed: z.number(),
    submittedIds: z.array(z.string().uuid()),
    failures: z.array(z.object({
      id: z.string().uuid(),
      reason: z.string(),
    })),
  }),
});

const deleteQuestionResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

// ── Exports ───────────────────────────────────────────────────────────────────

export const { schemas: questionSchemas, $ref: questionRef } = buildJsonSchemas({
  createQuestionBodySchema,
  updateQuestionBodySchema,
  listQuestionsQuerySchema,
  nextQuestionIdQuerySchema,
  nextQuestionIdResponseSchema,
  rejectQuestionBodySchema,
  idParamSchema,
  questionSchema,
  singleQuestionResponseSchema,
  paginatedQuestionsResponseSchema,
  bulkImportResponseSchema,
  bulkSubmitBodySchema,
  bulkSubmitResponseSchema,
  deleteQuestionResponseSchema,
  resolveImportBodySchema,
  resolveImportResponseSchema,
});

export type BulkSubmitBody = z.infer<typeof bulkSubmitBodySchema>;
export type CreateQuestionBody = z.infer<typeof createQuestionBodySchema>;
export type UpdateQuestionBody = z.infer<typeof updateQuestionBodySchema>;
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;
export type NextQuestionIdQuery = z.infer<typeof nextQuestionIdQuerySchema>;
export type RejectQuestionBody = z.infer<typeof rejectQuestionBodySchema>;
export type ResolveImportBody = z.infer<typeof resolveImportBodySchema>;
export type UnresolvedRowData = z.infer<typeof unresolvedRowDataSchema>;
export type UnresolvedRowItem = z.infer<typeof unresolvedRowSchema>;
