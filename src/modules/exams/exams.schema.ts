import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Shared enums ──────────────────────────────────────────────────────────────

const examTypeEnum = z.enum(["MOCK_EXAM", "ASSIGNMENT"]);
const gradingTypeEnum = z.enum(["AUTO", "MANUAL"]);
const examStatusEnum = z.enum(["DRAFT", "PUBLISHED"]);
const sessionStatusEnum = z.enum(["IN_PROGRESS", "SUBMITTED", "GRADED"]);
const retakeModeEnum = z.enum(["FULL", "INCORRECT_ONLY", "SUBJECT_ONLY"]);
const rankingLevelEnum = z.enum(["SUPERIOR", "ABOVE_AVERAGE", "HIGH_AVERAGE", "AVERAGE", "LOW_AVERAGE"]);
const answerReviewStatusEnum = z.enum(["NOT_APPLICABLE", "AI_GRADED", "PENDING_REVIEW", "MANUAL_GRADED"]);
const aiFeedbackConfidenceEnum = z.enum(["high", "medium", "low"]);
const manualGradingQueueStatusEnum = z.enum(["ALL", "PENDING_REVIEW", "GRADED"]);

const mcqOptionSchema = z.object({
  key: z.string(),
  text: z.string(),
});

const imageSummarySchema = z.object({
  fileName: z.string(),
  url: z.string().nullable(),
  altText: z.string().nullable(),
  caption: z.string().nullable(),
});

const passageSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  text: z.string().nullable(),
  imageRef: z.string().nullable(),
  imageDisplayPosition: z.enum(["above", "below", "inline"]).nullable(),
  image: imageSummarySchema.nullable(),
});

const aiFeedbackSchema = z.object({
  isCorrect: z.boolean().nullable(),
  confidence: aiFeedbackConfidenceEnum.nullable(),
  feedback: z.string().nullable(),
  pendingReview: z.boolean().nullable(),
  reason: z.string().nullable(),
  gradedAt: z.string().nullable(),
  aiRubric: z.object({
    id: z.string(),
    name: z.string(),
    totalMaxScore: z.number(),
  }).nullable(),
  criterionScores: z.array(z.object({
    criterionId: z.string(),
    criterionName: z.string(),
    score: z.number(),
    maxScore: z.number(),
    feedback: z.string(),
  })),
  totalAwardedMarks: z.number().nullable(),
  totalPossibleMarks: z.number().nullable(),
  scorePercent: z.number().nullable(),
});

// ── Exam CRUD schemas ─────────────────────────────────────────────────────────

const rankingThresholdSchema = z.number().int().min(0).max(100);

const createExamBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  examType: examTypeEnum,
  durationMinutes: z.number().int().min(1).max(600),
  gradingType: gradingTypeEnum,
  thresholdSuperior: rankingThresholdSchema.optional(),
  thresholdAboveAverage: rankingThresholdSchema.optional(),
  thresholdHighAverage: rankingThresholdSchema.optional(),
  thresholdAverage: rankingThresholdSchema.optional(),
});

const updateExamBodySchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    examType: examTypeEnum.optional(),
    durationMinutes: z.number().int().min(1).max(600).optional(),
    gradingType: gradingTypeEnum.optional(),
    thresholdSuperior: rankingThresholdSchema.optional(),
    thresholdAboveAverage: rankingThresholdSchema.optional(),
    thresholdHighAverage: rankingThresholdSchema.optional(),
    thresholdAverage: rankingThresholdSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

const examItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  examType: examTypeEnum,
  durationMinutes: z.number().nullable(),
  gradingType: gradingTypeEnum,
  status: examStatusEnum,
  createdBy: z.string(),
  creatorName: z.string(),
  questionCount: z.number(),
  hasSessions: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  thresholdSuperior: z.number(),
  thresholdAboveAverage: z.number(),
  thresholdHighAverage: z.number(),
  thresholdAverage: z.number(),
});

const publishExamBodySchema = z.object({
  status: examStatusEnum,
  durationMinutes: z.number().int().min(1).max(600).optional(),
  gradingType: gradingTypeEnum.optional(),
});

const publishExamResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: examItemSchema,
});

const listExamsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  examType: examTypeEnum.optional(),
});

const paginatedExamsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(examItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const singleExamResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: examItemSchema,
});

const examDeleteResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const examIdParamSchema = z.object({
  id: z.string().uuid(),
});

// ── Exam Questions schemas ────────────────────────────────────────────────────

const addExamQuestionsBodySchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1).max(200),
});

const examQuestionItemSchema = z.object({
  examId: z.string(),
  questionId: z.string(),
  order: z.number(),
  question: z.object({
    id: z.string(),
    questionId: z.string().nullable(),
    type: z.enum(["MCQ", "ESSAY"]),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
    questionText: z.string(),
    latexEnabled: z.boolean(),
    options: z.array(mcqOptionSchema).nullable(),
    correctAnswer: z.string(),
    imageRefs: z.array(z.string()),
    images: z.array(imageSummarySchema),
    subjectName: z.string(),
    topicName: z.string(),
  }),
});

const examWithQuestionsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    exam: examItemSchema,
    questions: z.array(examQuestionItemSchema),
  }),
});

const examQuestionParamSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
});

const examQuestionsListResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(examQuestionItemSchema),
});

// ── Session schemas ───────────────────────────────────────────────────────────

const sessionQuestionSchema = z.object({
  questionId: z.string(),
  order: z.number(),
  type: z.enum(["MCQ", "ESSAY"]),
  questionText: z.string(),
  promptText: z.string().nullable(),
  latexEnabled: z.boolean(),
  options: z.array(mcqOptionSchema).nullable(),
  imageRefs: z.array(z.string()),
  images: z.array(imageSummarySchema),
  subjectName: z.string(),
  topicName: z.string(),
  passage: passageSummarySchema.nullable(),
  existingAnswer: z
    .object({
      studentAnswer: z.string(),
      timeSpentSeconds: z.number(),
    })
    .nullable(),
});

const startSessionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    examId: z.string(),
    examTitle: z.string(),
    durationMinutes: z.number(),
    gradingType: gradingTypeEnum,
    status: sessionStatusEnum,
    startTime: z.string(),
    expiresAt: z.string(),
    serverNow: z.string(),
    secondsRemaining: z.number(),
    activeTimeSeconds: z.number(),
    idleTimeSeconds: z.number(),
    questions: z.array(sessionQuestionSchema),
    answeredCount: z.number(),
  }),
});

const examSessionParamSchema = z.object({
  sessionId: z.string().uuid(),
});

const submitAnswerBodySchema = z.object({
  questionId: z.string().uuid(),
  studentAnswer: z.string().max(5000),
  timeSpentSeconds: z.number().int().min(0),
  timeSpentDeltaSeconds: z.number().int().min(0).max(300).optional(),
});

const submitAnswerResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    questionId: z.string(),
    studentAnswer: z.string(),
    timeSpentSeconds: z.number(),
  }),
});

const batchAnswerItemSchema = z.object({
  questionId: z.string().uuid(),
  studentAnswer: z.string().max(5000),
  timeSpentSeconds: z.number().int().min(0),
});

const batchAnswersBodySchema = z.object({
  answers: z.array(batchAnswerItemSchema).min(1).max(200),
});

const batchAnswersResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    savedCount: z.number(),
  }),
});

const submitSessionBodySchema = z.object({
  totalTimeSeconds: z.number().int().min(0).optional(),
  answers: z.array(batchAnswerItemSchema).max(200).optional(),
});

const sessionHeartbeatBodySchema = z.object({
  activeQuestionId: z.string().uuid().nullable().optional(),
  activeTimeDeltaSeconds: z.number().int().min(0).max(300).default(0),
  idleTimeDeltaSeconds: z.number().int().min(0).max(300).default(0),
});

const sessionHeartbeatResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    status: sessionStatusEnum,
    serverNow: z.string(),
    expiresAt: z.string(),
    secondsRemaining: z.number(),
    activeQuestionId: z.string().nullable(),
    activeTimeSeconds: z.number(),
    idleTimeSeconds: z.number(),
    expired: z.boolean(),
  }),
});

const submitSessionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    status: sessionStatusEnum,
    submittedAt: z.string(),
    totalTimeSeconds: z.number(),
    message: z.string(),
  }),
});

const sessionResultAnswerSchema = z.object({
  questionId: z.string(),
  order: z.number(),
  questionText: z.string(),
  promptText: z.string().nullable(),
  latexEnabled: z.boolean(),
  type: z.enum(["MCQ", "ESSAY"]),
  options: z.array(mcqOptionSchema).nullable(),
  studentAnswer: z.string(),
  correctAnswer: z.string(),
  explanation: z.string().nullable(),
  maxMarks: z.number(),
  isCorrect: z.boolean(),
  timeSpentSeconds: z.number(),
  awardedMarks: z.number().nullable(),
  manualScore: z.number().nullable(),
  tutorFeedback: z.string().nullable(),
  reviewStatus: answerReviewStatusEnum,
  aiFeedback: aiFeedbackSchema.nullable(),
});

const sessionResultResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    examId: z.string(),
    examTitle: z.string(),
    status: sessionStatusEnum,
    finalScore: z.number().nullable(),
    mcqScore: z.number().nullable(),
    essayScore: z.number().nullable(),
    rankingLevel: rankingLevelEnum.nullable(),
    totalTimeSeconds: z.number().nullable(),
    activeTimeSeconds: z.number(),
    idleTimeSeconds: z.number(),
    totalQuestions: z.number(),
    correctCount: z.number(),
    gradingType: gradingTypeEnum,
    startTime: z.string(),
    endTime: z.string().nullable(),
    answers: z.array(sessionResultAnswerSchema),
  }),
});

const listSessionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const examSubmissionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: manualGradingQueueStatusEnum.default("ALL"),
});

const manualGradingSubmissionSchema = z.object({
  sessionId: z.string(),
  studentId: z.string(),
  studentName: z.string(),
  studentEmail: z.string(),
  status: sessionStatusEnum,
  finalScore: z.number().nullable(),
  rankingLevel: rankingLevelEnum.nullable(),
  submittedAt: z.string().nullable(),
  gradedAt: z.string().nullable(),
  totalAnswers: z.number(),
  totalEssayAnswers: z.number(),
  pendingReviewCount: z.number(),
  reviewedEssayCount: z.number(),
  totalTimeSeconds: z.number().int().nullable(),
  activeTimeSeconds: z.number(),
  idleTimeSeconds: z.number(),
});

const examSubmissionsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    exam: examItemSchema,
    submissions: z.array(manualGradingSubmissionSchema),
  }),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const reviewSessionAnswerSchema = z.object({
  answerId: z.string().nullable(),
  questionId: z.string(),
  order: z.number(),
  type: z.enum(["MCQ", "ESSAY"]),
  questionText: z.string(),
  promptText: z.string().nullable(),
  latexEnabled: z.boolean(),
  options: z.array(mcqOptionSchema).nullable(),
  correctAnswer: z.string(),
  explanation: z.string().nullable(),
  studentAnswer: z.string(),
  timeSpentSeconds: z.number(),
  maxMarks: z.number(),
  isCorrect: z.boolean(),
  awardedMarks: z.number().nullable(),
  manualScore: z.number().nullable(),
  tutorFeedback: z.string().nullable(),
  reviewStatus: answerReviewStatusEnum,
  aiFeedback: aiFeedbackSchema.nullable(),
});

const reviewSessionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    examId: z.string(),
    examTitle: z.string(),
    gradingType: gradingTypeEnum,
    status: sessionStatusEnum,
    student: z.object({
      id: z.string(),
      fullName: z.string(),
      email: z.string(),
    }),
    finalScore: z.number().nullable(),
    mcqScore: z.number().nullable(),
    essayScore: z.number().nullable(),
    rankingLevel: rankingLevelEnum.nullable(),
    totalTimeSeconds: z.number().nullable(),
    activeTimeSeconds: z.number(),
    idleTimeSeconds: z.number(),
    startTime: z.string(),
    endTime: z.string().nullable(),
    answers: z.array(reviewSessionAnswerSchema),
  }),
});

const manualGradeItemSchema = z.object({
  questionId: z.string().uuid(),
  manualScore: z.number().min(0),
  tutorFeedback: z.string().trim().max(2000).nullable(),
});

const submitManualGradesBodySchema = z.object({
  grades: z.array(manualGradeItemSchema).min(1).max(200),
});

const submitManualGradesResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    status: sessionStatusEnum,
    finalScore: z.number().nullable(),
    rankingLevel: rankingLevelEnum.nullable(),
    pendingReviewCount: z.number(),
  }),
});

const sessionSummarySchema = z.object({
  sessionId: z.string(),
  examId: z.string(),
  examTitle: z.string(),
  examType: examTypeEnum,
  durationMinutes: z.number(),
  status: sessionStatusEnum,
  finalScore: z.number().nullable(),
  rankingLevel: rankingLevelEnum.nullable(),
  totalTimeSeconds: z.number().nullable(),
  activeTimeSeconds: z.number(),
  idleTimeSeconds: z.number(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  attemptNumber: z.number(),
  retakeMode: retakeModeEnum.nullable(),
});

const paginatedSessionsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(sessionSummarySchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const sessionInsightsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    summary: z.string(),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    advice: z.array(z.string()),
  }),
});

// ── Retake schemas ───────────────────────────────────────────────────────────

const startRetakeBodySchema = z.object({
  mode: retakeModeEnum,
  sourceSessionId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
}).refine(
  (data) => {
    if (data.mode === "INCORRECT_ONLY" && !data.sourceSessionId) return false;
    if (data.mode === "SUBJECT_ONLY" && !data.subjectId) return false;
    return true;
  },
  {
    message: "sourceSessionId is required for INCORRECT_ONLY mode; subjectId is required for SUBJECT_ONLY mode",
  }
);

const attemptSummaryItemSchema = z.object({
  sessionId: z.string(),
  attemptNumber: z.number(),
  retakeMode: retakeModeEnum.nullable(),
  finalScore: z.number().nullable(),
  rankingLevel: rankingLevelEnum.nullable(),
  totalTimeSeconds: z.number().nullable(),
  activeTimeSeconds: z.number(),
  idleTimeSeconds: z.number(),
  status: sessionStatusEnum,
  startTime: z.string(),
  endTime: z.string().nullable(),
});

const incorrectQuestionItemSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  type: z.enum(["MCQ", "ESSAY"]),
  subjectName: z.string(),
  topicName: z.string(),
  studentAnswer: z.string(),
  correctAnswer: z.string(),
});

const examAttemptSummaryResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    examId: z.string(),
    examTitle: z.string(),
    totalAttempts: z.number(),
    firstAttempt: attemptSummaryItemSchema.nullable(),
    latestAttempt: attemptSummaryItemSchema.nullable(),
    bestScore: attemptSummaryItemSchema.nullable(),
    incorrectQuestions: z.array(incorrectQuestionItemSchema),
    subjects: z.array(z.object({
      subjectId: z.string(),
      subjectName: z.string(),
      totalQuestions: z.number(),
      correctCount: z.number(),
    })),
  }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreateExamBody = z.infer<typeof createExamBodySchema>;
export type UpdateExamBody = z.infer<typeof updateExamBodySchema>;
export type ListExamsQuery = z.infer<typeof listExamsQuerySchema>;
export type PublishExamBody = z.infer<typeof publishExamBodySchema>;
export type AddExamQuestionsBody = z.infer<typeof addExamQuestionsBodySchema>;
export type SubmitAnswerBody = z.infer<typeof submitAnswerBodySchema>;
export type BatchAnswersBody = z.infer<typeof batchAnswersBodySchema>;
export type SubmitSessionBody = z.infer<typeof submitSessionBodySchema>;
export type SessionHeartbeatBody = z.infer<typeof sessionHeartbeatBodySchema>;
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
export type ExamSubmissionsQuery = z.infer<typeof examSubmissionsQuerySchema>;
export type SubmitManualGradesBody = z.infer<typeof submitManualGradesBodySchema>;
export type StartRetakeBody = z.infer<typeof startRetakeBodySchema>;

// ── Export ────────────────────────────────────────────────────────────────────

export const { schemas: examSchemas, $ref: examRef } = buildJsonSchemas({
  createExamBodySchema,
  updateExamBodySchema,
  examItemSchema,
  listExamsQuerySchema,
  paginatedExamsResponseSchema,
  singleExamResponseSchema,
  examDeleteResponseSchema,
  examIdParamSchema,
  addExamQuestionsBodySchema,
  examQuestionItemSchema,
  examWithQuestionsResponseSchema,
  examQuestionParamSchema,
  examQuestionsListResponseSchema,
  sessionQuestionSchema,
  startSessionResponseSchema,
  examSessionParamSchema,
  submitAnswerBodySchema,
  submitAnswerResponseSchema,
  batchAnswerItemSchema,
  batchAnswersBodySchema,
  batchAnswersResponseSchema,
  submitSessionBodySchema,
  submitSessionResponseSchema,
  sessionHeartbeatBodySchema,
  sessionHeartbeatResponseSchema,
  sessionResultAnswerSchema,
  sessionResultResponseSchema,
  listSessionsQuerySchema,
  examSubmissionsQuerySchema,
  manualGradingSubmissionSchema,
  examSubmissionsResponseSchema,
  reviewSessionAnswerSchema,
  reviewSessionResponseSchema,
  manualGradeItemSchema,
  submitManualGradesBodySchema,
  submitManualGradesResponseSchema,
  sessionSummarySchema,
  paginatedSessionsResponseSchema,
  publishExamBodySchema,
  publishExamResponseSchema,
  sessionInsightsResponseSchema,
  startRetakeBodySchema,
  attemptSummaryItemSchema,
  incorrectQuestionItemSchema,
  examAttemptSummaryResponseSchema,
});
