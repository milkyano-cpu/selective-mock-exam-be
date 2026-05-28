import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Shared sub-schemas ────────────────────────────────────────────────────────

const examHistoryItemSchema = z.object({
  examId:           z.string(),
  examTitle:        z.string(),
  examType:         z.string(),
  bestSessionId:    z.string().nullable(),
  bestScore:        z.number().nullable(),
  latestSessionId:  z.string().nullable(),
  latestScore:      z.number().nullable(),
  totalAttempts:    z.number(),
  rankingLevel:     z.string().nullable(),
  totalTimeSeconds: z.number().nullable(),
  takenAt:          z.string(),
  // Legacy aliases retained for FE compatibility — point to the best attempt
  // (which is what overallAvg now counts). Prefer bestSessionId / bestScore.
  sessionId:        z.string(),
  finalScore:       z.number().nullable(),
});

const topicPerformanceItemSchema = z.object({
  topicId:      z.string(),
  topicName:    z.string(),
  subjectId:    z.string(),
  subjectName:  z.string(),
  scoreAvg:     z.number(),
  attemptCount: z.number(),
});

const subjectPerformanceItemSchema = z.object({
  subjectId:    z.string(),
  subjectName:  z.string(),
  scoreAvg:     z.number(),
  topicCount:   z.number(),
  bandLevel:    z.string(),
});

const scoreHistoryItemSchema = z.object({
  sessionId:     z.string(),
  examTitle:     z.string(),
  score:         z.number(),
  rankingLevel:  z.string().nullable(),
  takenAt:       z.string(),
  attemptNumber: z.number(),
});

const writingPerformanceCriterionSchema = z.object({
  criterionName: z.string(),
  score:         z.number(),
  maxScore:      z.number(),
  scorePercent:  z.number(),
  feedback:      z.string().nullable(),
  strengths:     z.array(z.string()),
  improvements:  z.array(z.string()),
});

const writingPerformanceItemSchema = z.object({
  sessionId:       z.string(),
  examTitle:       z.string(),
  takenAt:         z.string(),
  bandLabel:       z.string().nullable(),
  bandDescriptor:  z.string().nullable(),
  criteria:        z.array(writingPerformanceCriterionSchema),
});

const tierRequiredResponseSchema = z.object({
  success: z.literal(false),
  error: z.literal("tier_required"),
  message: z.string(),
  requiredTier: z.literal("STANDARD"),
  upgradeUrl: z.literal("/dashboard/billing"),
});

// ── GET /analytics/me ─────────────────────────────────────────────────────────

const myAnalyticsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    overallAvg:       z.number().nullable(),
    totalExams:       z.number(),
    totalTimeSeconds: z.number(),
    rankingLevel:     z.string().nullable(),
    examHistory:      z.array(examHistoryItemSchema),
    topicPerformance: z.array(topicPerformanceItemSchema),
    subjectPerformance: z.array(subjectPerformanceItemSchema).optional(),
    scoreHistory: z.array(scoreHistoryItemSchema).optional(),
    percentile: z.number().nullable().optional(),
    writingPerformance: z.array(writingPerformanceItemSchema).optional(),
  }),
});

// ── GET /analytics/leaderboard ────────────────────────────────────────────────

const leaderboardQuerySchema = z.object({
  period: z.enum(["WEEKLY", "MONTHLY", "ALL_TIME"]).default("ALL_TIME"),
  examId: z.string().uuid().optional(),
});

const leaderboardEntrySchema = z.object({
  rank:         z.number(),
  studentId:    z.string(),
  studentName:  z.string(),
  avatarUrl:    z.string().nullable(),
  score:        z.number(),
  rankingLevel: z.string().nullable(),
  totalExams:   z.number(),
  avgTimeSeconds: z.number().nullable(),
});

const leaderboardResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    period:  z.string(),
    entries: z.array(leaderboardEntrySchema),
    myRank: z.object({
      rank:         z.number().nullable(),
      studentId:    z.string(),
      studentName:  z.string().nullable(),
      avatarUrl:    z.string().nullable(),
      score:        z.number().nullable(),
      rankingLevel: z.string().nullable(),
      totalExams:   z.number().nullable(),
      avgTimeSeconds: z.number().nullable(),
      percentile:   z.number().nullable(),
    }),
  }),
});

// ── GET /analytics/students/:studentId ───────────────────────────────────────

const studentAnalyticsParamsSchema = z.object({
  studentId: z.string().uuid(),
});

const studentAnalyticsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    studentId:    z.string(),
    studentName:  z.string(),
    avatarUrl:    z.string().nullable(),
    overallAvg:   z.number().nullable(),
    totalExams:   z.number(),
    totalTimeSeconds: z.number(),
    rankingLevel: z.string().nullable(),
    examHistory:  z.array(examHistoryItemSchema),
    topicPerformance: z.array(topicPerformanceItemSchema),
    subjectPerformance: z.array(subjectPerformanceItemSchema).optional(),
    scoreHistory: z.array(scoreHistoryItemSchema).optional(),
    percentile: z.number().nullable().optional(),
    writingPerformance: z.array(writingPerformanceItemSchema).optional(),
  }),
});

const childrenAnalyticsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(
    z.object({
      studentId:    z.string(),
      studentName:  z.string(),
      avatarUrl:    z.string().nullable(),
      overallAvg:   z.number().nullable(),
      totalExams:   z.number(),
      totalTimeSeconds: z.number(),
      rankingLevel: z.string().nullable(),
      examHistory:  z.array(examHistoryItemSchema),
      topicPerformance: z.array(topicPerformanceItemSchema),
      subjectPerformance: z.array(subjectPerformanceItemSchema).optional(),
      scoreHistory: z.array(scoreHistoryItemSchema).optional(),
      percentile: z.number().nullable().optional(),
      writingPerformance: z.array(writingPerformanceItemSchema).optional(),
    })
  ),
});

// ── Export ────────────────────────────────────────────────────────────────────

export const { schemas: analyticsSchemas, $ref: analyticsRef } = buildJsonSchemas({
  tierRequiredResponseSchema,
  myAnalyticsResponseSchema,
  leaderboardQuerySchema,
  leaderboardResponseSchema,
  studentAnalyticsParamsSchema,
  studentAnalyticsResponseSchema,
  childrenAnalyticsResponseSchema,
});

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type StudentAnalyticsParams = z.infer<typeof studentAnalyticsParamsSchema>;
