import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Shared enums ──────────────────────────────────────────────────────────────

const practiceStatusEnum = z.enum(["IN_PROGRESS", "COMPLETED"]);
const difficultyEnum = z.enum(["EASY", "MEDIUM", "HARD"]);
const difficultyFilterEnum = z.enum(["ALL", "EASY", "MEDIUM", "HARD"]);
const practiceSourceEnum = z.enum(["SELF_SELECTED", "TUTOR_ASSIGNED", "RECOMMENDATION"]);

const mcqOptionSchema = z.object({
  key: z.string(),
  text: z.string(),
});

// ── Shared question schemas ───────────────────────────────────────────────────

// Questions without correct answers (shown during IN_PROGRESS session)
const practiceQuestionSchema = z.object({
  questionId: z.string(),
  order: z.number(),
  contentText: z.string(),
  contentLatex: z.string().nullable(),
  isLatexFormat: z.boolean(),
  difficulty: difficultyEnum,
  options: z.array(mcqOptionSchema).nullable(),
  imageUrl: z.string().nullable(),
  imageUrls: z.array(z.string()),
});

// Questions with correct answers and student responses (shown after COMPLETED)
const practiceResultAnswerSchema = z.object({
  questionId: z.string(),
  order: z.number(),
  contentText: z.string(),
  contentLatex: z.string().nullable(),
  isLatexFormat: z.boolean(),
  difficulty: difficultyEnum,
  options: z.array(mcqOptionSchema).nullable(),
  imageUrl: z.string().nullable(),
  imageUrls: z.array(z.string()),
  correctAnswer: z.string(),
  explanation: z.string().nullable(),
  studentAnswer: z.string(),
  isCorrect: z.boolean(),
  timeSpentSeconds: z.number(),
});

// ── Request schemas ───────────────────────────────────────────────────────────

const startPracticeBodySchema = z
  .object({
    topicId: z.string().uuid().optional(),
    subjectId: z.string().uuid().optional(),
    subtopics: z.array(z.string().min(1)).max(10).optional(),
    difficulty: difficultyFilterEnum.default("ALL"),
    questionCount: z
      .union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)])
      .default(10),
    excludeCompleted: z.boolean().default(false),
    incorrectOnly: z.boolean().default(false),
  })
  .refine((data) => data.topicId !== undefined || data.subjectId !== undefined, {
    message: "Either topicId or subjectId must be provided",
  });

const startWeakAreaPracticeBodySchema = z.object({
  questionCount: z
    .union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)])
    .default(10),
  weaknessThreshold: z.coerce.number().min(1).max(100).default(60),
  subjectId: z.string().uuid().optional(),
});

const getRecommendationsQuerySchema = z.object({
  threshold: z.coerce.number().min(1).max(100).default(60),
  subjectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

const submitPracticeBodySchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        studentAnswer: z.string().min(1).max(10),
        timeSpentSeconds: z.number().int().min(0),
      })
    )
    .min(1)
    .max(50),
});

const practiceSessionParamSchema = z.object({
  sessionId: z.string().uuid(),
});

const listPracticeSessionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  topicId: z.string().uuid().optional(),
  status: practiceStatusEnum.optional(),
  sourceType: practiceSourceEnum.optional(),
});

// Tutor: create assignment
const createAssignmentBodySchema = z.object({
  studentId: z.string().uuid(),
  questionIds: z.array(z.string().uuid()).min(1).max(50),
  topicId: z.string().uuid().optional(),
});

const listAssignmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  studentId: z.string().uuid().optional(),
  status: practiceStatusEnum.optional(),
});

// ── Response schemas ──────────────────────────────────────────────────────────

const practiceErrorResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

const startPracticeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    topicId: z.string().nullable(),
    topicName: z.string().nullable(),
    subjectId: z.string().nullable(),
    subjectName: z.string().nullable(),
    sourceType: practiceSourceEnum,
    difficulty: difficultyFilterEnum,
    questionCount: z.number(),
    status: practiceStatusEnum,
    startedAt: z.string(),
    questions: z.array(practiceQuestionSchema),
  }),
});

const weakTopicSchema = z.object({
  topicId: z.string(),
  topicName: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  scoreAvg: z.number(),
});

const startWeakAreaPracticeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    sourceType: practiceSourceEnum,
    weakTopics: z.array(weakTopicSchema),
    difficulty: difficultyFilterEnum,
    questionCount: z.number(),
    status: practiceStatusEnum,
    startedAt: z.string(),
    questions: z.array(practiceQuestionSchema),
  }),
});

const recommendationItemSchema = z.object({
  topicId: z.string(),
  topicName: z.string(),
  subjectId: z.string(),
  subjectName: z.string(),
  scoreAvg: z.number(),
  attemptCount: z.number(),
  availableQuestions: z.number(),
});

const getRecommendationsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(recommendationItemSchema),
});

const practiceAccessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    tier: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
    fullPracticeAccess: z.boolean(),
    freeTopics: z.array(
      z.object({
        subjectId: z.string(),
        subjectName: z.string(),
        topicId: z.string(),
        topicName: z.string(),
        availableQuestions: z.number(),
      })
    ),
  }),
});

const getPracticeSessionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    topicId: z.string().nullable(),
    topicName: z.string().nullable(),
    subjectId: z.string().nullable(),
    subjectName: z.string().nullable(),
    sourceType: practiceSourceEnum,
    difficulty: difficultyFilterEnum,
    questionCount: z.number(),
    status: practiceStatusEnum,
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    questions: z.array(practiceQuestionSchema),
    answers: z.array(practiceResultAnswerSchema).nullable(),
  }),
});

const submitPracticeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    topicId: z.string().nullable(),
    topicName: z.string().nullable(),
    status: practiceStatusEnum,
    totalQuestions: z.number(),
    correctCount: z.number(),
    scorePercent: z.number(),
    endedAt: z.string(),
    answers: z.array(practiceResultAnswerSchema),
  }),
});

const practiceSessionSummarySchema = z.object({
  sessionId: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  subjectId: z.string().nullable(),
  subjectName: z.string().nullable(),
  sourceType: practiceSourceEnum,
  difficulty: difficultyFilterEnum,
  questionCount: z.number(),
  status: practiceStatusEnum,
  scorePercent: z.number().nullable(),
  correctCount: z.number().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});

const listPracticeSessionsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(practiceSessionSummarySchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const createAssignmentResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    studentId: z.string(),
    studentName: z.string(),
    topicId: z.string().nullable(),
    sourceType: practiceSourceEnum,
    questionCount: z.number(),
    status: practiceStatusEnum,
    startedAt: z.string(),
  }),
});

const assignmentSummarySchema = z.object({
  sessionId: z.string(),
  studentId: z.string(),
  studentName: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  subjectId: z.string().nullable(),
  subjectName: z.string().nullable(),
  difficulty: difficultyFilterEnum,
  questionCount: z.number(),
  status: practiceStatusEnum,
  scorePercent: z.number().nullable(),
  correctCount: z.number().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});

const listAssignmentsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(assignmentSummarySchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

// ── Exports ───────────────────────────────────────────────────────────────────

export type StartPracticeBody = z.infer<typeof startPracticeBodySchema>;
export type StartWeakAreaPracticeBody = z.infer<typeof startWeakAreaPracticeBodySchema>;
export type GetRecommendationsQuery = z.infer<typeof getRecommendationsQuerySchema>;
export type SubmitPracticeBody = z.infer<typeof submitPracticeBodySchema>;
export type ListPracticeSessionsQuery = z.infer<typeof listPracticeSessionsQuerySchema>;
export type CreateAssignmentBody = z.infer<typeof createAssignmentBodySchema>;
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuerySchema>;

export const { schemas: practiceSchemas, $ref: practiceRef } = buildJsonSchemas({
  startPracticeBodySchema,
  startWeakAreaPracticeBodySchema,
  getRecommendationsQuerySchema,
  submitPracticeBodySchema,
  practiceSessionParamSchema,
  listPracticeSessionsQuerySchema,
  createAssignmentBodySchema,
  listAssignmentsQuerySchema,
  startPracticeResponseSchema,
  startWeakAreaPracticeResponseSchema,
  getRecommendationsResponseSchema,
  practiceAccessResponseSchema,
  getPracticeSessionResponseSchema,
  submitPracticeResponseSchema,
  listPracticeSessionsResponseSchema,
  createAssignmentResponseSchema,
  listAssignmentsResponseSchema,
  practiceErrorResponseSchema,
});
