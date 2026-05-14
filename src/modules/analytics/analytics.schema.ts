import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

// ── Shared sub-schemas ────────────────────────────────────────────────────────

const examHistoryItemSchema = z.object({
  sessionId:   z.string(),
  examId:      z.string(),
  examTitle:   z.string(),
  finalScore:  z.number().nullable(),
  rankingLevel: z.string().nullable(),
  totalTimeSeconds: z.number().nullable(),
  takenAt:     z.string(),
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
    subjectPerformance: z.array(subjectPerformanceItemSchema),
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
    subjectPerformance: z.array(subjectPerformanceItemSchema),
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
      subjectPerformance: z.array(subjectPerformanceItemSchema),
    })
  ),
});

// ── Export ────────────────────────────────────────────────────────────────────

export const { schemas: analyticsSchemas, $ref: analyticsRef } = buildJsonSchemas({
  myAnalyticsResponseSchema,
  leaderboardQuerySchema,
  leaderboardResponseSchema,
  studentAnalyticsParamsSchema,
  studentAnalyticsResponseSchema,
  childrenAnalyticsResponseSchema,
});

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type StudentAnalyticsParams = z.infer<typeof studentAnalyticsParamsSchema>;
