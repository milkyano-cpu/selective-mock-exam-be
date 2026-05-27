import type { PrismaClient } from "@prisma/client";
import type { LeaderboardQuery } from "./analytics.schema.js";
import { decryptField } from "../../utils/field-encryption.js";
import type { MembershipTier } from "../../utils/membership.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function periodStartDate(period: LeaderboardQuery["period"]): Date | null {
  const now = new Date();
  if (period === "WEEKLY") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (period === "MONTHLY") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d;
  }
  return null; // ALL_TIME
}

function deriveRankingLevel(avg: number): string {
  if (avg >= 72) return "SUPERIOR";
  if (avg >= 60) return "ABOVE_AVERAGE";
  if (avg >= 50) return "HIGH_AVERAGE";
  if (avg >= 40) return "AVERAGE";
  return "LOW_AVERAGE";
}

// ── Shared: build analytics payload for a given studentId ────────────────────

const basicAnalyticsFields = [
  "studentId",
  "studentName",
  "avatarUrl",
  "overallAvg",
  "totalExams",
  "totalTimeSeconds",
  "rankingLevel",
  "examHistory",
  "topicPerformance",
] as const;

const standardAnalyticsFields = [
  ...basicAnalyticsFields,
  "scoreHistory",
  "subjectPerformance",
  "percentile",
] as const;

export function serializeAnalyticsForTier<T extends Record<string, unknown>>(data: T, tier: MembershipTier) {
  if (tier === "PREMIUM") return data;

  const allowedFields = tier === "STANDARD" ? standardAnalyticsFields : basicAnalyticsFields;
  return Object.fromEntries(
    allowedFields
      .filter((field) => field in data)
      .map((field) => [field, data[field]])
  );
}

function calculatePeerPercentile(score: number, peerAverages: number[]) {
  if (peerAverages.length === 0) return 0;

  const belowCount = peerAverages.filter((average) => average < score).length;
  return Math.round((belowCount / peerAverages.length) * 1000) / 10;
}

async function getStudentPercentile(prisma: PrismaClient, studentId: string, overallAvg: number | null) {
  if (overallAvg === null) return null;

  const peerSessions = await prisma.examSession.findMany({
    where: {
      studentId: { not: studentId },
      status: "GRADED",
      finalScore: { not: null },
      student: { role: "STUDENT" },
    },
    select: {
      studentId: true,
      finalScore: true,
    },
  });

  const peerTotals = new Map<string, { total: number; count: number }>();
  for (const session of peerSessions) {
    const entry = peerTotals.get(session.studentId) ?? { total: 0, count: 0 };
    entry.total += Number(session.finalScore!);
    entry.count += 1;
    peerTotals.set(session.studentId, entry);
  }

  const peerAverages = Array.from(peerTotals.values()).map((entry) => entry.total / entry.count);
  return calculatePeerPercentile(overallAvg, peerAverages);
}

async function buildWritingPerformance(prisma: PrismaClient, studentId: string) {
  const scores = await prisma.essayAnswerScore.findMany({
    where: {
      studentAnswer: {
        session: {
          studentId,
          status: "GRADED",
        },
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      criterionName: true,
      score: true,
      maxScore: true,
      feedback: true,
      strengths: true,
      improvements: true,
      studentAnswer: {
        select: {
          bandLabel: true,
          bandDescriptor: true,
          session: {
            select: {
              id: true,
              endTime: true,
              exam: { select: { title: true } },
            },
          },
        },
      },
    },
  });

  const writingBySession = new Map<string, {
    sessionId: string;
    examTitle: string;
    takenAt: string;
    sortTime: number;
    bandLabel: string | null;
    bandDescriptor: string | null;
    criteria: Array<{
      criterionName: string;
      score: number;
      maxScore: number;
      scorePercent: number;
      feedback: string | null;
      strengths: string[];
      improvements: string[];
    }>;
  }>();

  for (const score of scores) {
    const answer = score.studentAnswer;
    const session = answer.session;
    const existing = writingBySession.get(session.id);
    const entry = existing ?? {
      sessionId: session.id,
      examTitle: session.exam.title,
      takenAt: session.endTime?.toISOString() ?? new Date().toISOString(),
      sortTime: session.endTime?.getTime() ?? Number.MAX_SAFE_INTEGER,
      bandLabel: answer.bandLabel ?? null,
      bandDescriptor: answer.bandDescriptor ?? null,
      criteria: [],
    };

    if (entry.bandLabel === null && answer.bandLabel !== null) entry.bandLabel = answer.bandLabel;
    if (entry.bandDescriptor === null && answer.bandDescriptor !== null) entry.bandDescriptor = answer.bandDescriptor;

    const numericScore = Number(score.score);
    const maxScore = Number(score.maxScore);
    entry.criteria.push({
      criterionName: score.criterionName,
      score: numericScore,
      maxScore,
      scorePercent: maxScore > 0 ? (numericScore / maxScore) * 100 : 0,
      feedback: score.feedback ?? null,
      strengths: score.strengths,
      improvements: score.improvements,
    });
    writingBySession.set(session.id, entry);
  }

  return Array.from(writingBySession.values())
    .sort((a, b) => a.sortTime - b.sortTime)
    .map(({ sortTime: _sortTime, ...session }) => session);
}

export async function buildStudentAnalytics(prisma: PrismaClient, studentId: string) {
  // 1. Graded exam sessions ordered by endTime desc
  const sessions = await prisma.examSession.findMany({
    where: { studentId, status: "GRADED" },
    orderBy: { endTime: "desc" },
    select: {
      id: true,
      examId: true,
      finalScore: true,
      rankingLevel: true,
      totalTimeSeconds: true,
      endTime: true,
      attemptNumber: true,
      exam: { select: { title: true } },
    },
  });

  const examHistory = sessions.map((s) => ({
    sessionId:        s.id,
    examId:           s.examId,
    examTitle:        s.exam.title,
    finalScore:       s.finalScore !== null ? Number(s.finalScore) : null,
    rankingLevel:     s.rankingLevel ?? null,
    totalTimeSeconds: s.totalTimeSeconds ?? null,
    takenAt:          s.endTime?.toISOString() ?? new Date().toISOString(),
  }));

  const scoreHistory = sessions
    .filter((session) => session.finalScore !== null)
    .slice()
    .sort((a, b) => (a.endTime?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.endTime?.getTime() ?? Number.MAX_SAFE_INTEGER))
    .map((session) => ({
      sessionId: session.id,
      examTitle: session.exam.title,
      score: Number(session.finalScore!),
      rankingLevel: session.rankingLevel ?? null,
      takenAt: session.endTime?.toISOString() ?? new Date().toISOString(),
      attemptNumber: session.attemptNumber,
    }));

  // 2. Topic-level performance from StudentPerformance
  const topicPerfs = await prisma.studentPerformance.findMany({
    where: { studentId },
    orderBy: { scoreAvg: "asc" }, // weakest first
    select: {
      topicId:      true,
      scoreAvg:     true,
      attemptCount: true,
      topic:   { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
    },
  });

  const topicPerformance = topicPerfs.map((p) => ({
    topicId:      p.topicId,
    topicName:    p.topic.name,
    subjectId:    p.subject.id,
    subjectName:  p.subject.name,
    scoreAvg:     Number(p.scoreAvg),
    attemptCount: p.attemptCount,
  }));

  // 3. Aggregate per subject (average of topic averages within subject)
  const subjectMap = new Map<string, { name: string; total: number; count: number }>();
  for (const t of topicPerformance) {
    const entry = subjectMap.get(t.subjectId) ?? { name: t.subjectName, total: 0, count: 0 };
    entry.total += t.scoreAvg;
    entry.count += 1;
    subjectMap.set(t.subjectId, entry);
  }
  const subjectPerformance = Array.from(subjectMap.entries()).map(([subjectId, v]) => {
    const scoreAvg = v.count > 0 ? v.total / v.count : 0;
    return {
      subjectId,
      subjectName: v.name,
      scoreAvg,
      topicCount: v.count,
      bandLevel: deriveRankingLevel(scoreAvg),
    };
  });

  // 4. Aggregate totals
  const totalExams = sessions.length;
  const totalTimeSeconds = sessions.reduce((sum, s) => sum + (s.totalTimeSeconds ?? 0), 0);
  const scoredSessions = sessions.filter((s) => s.finalScore !== null);
  const overallAvg = scoredSessions.length > 0
    ? scoredSessions.reduce((sum, s) => sum + Number(s.finalScore!), 0) / scoredSessions.length
    : null;
  const rankingLevel = overallAvg !== null ? deriveRankingLevel(overallAvg) : null;
  const [percentile, writingPerformance] = await Promise.all([
    getStudentPercentile(prisma, studentId, overallAvg),
    buildWritingPerformance(prisma, studentId),
  ]);

  return {
    overallAvg,
    totalExams,
    totalTimeSeconds,
    rankingLevel,
    examHistory,
    topicPerformance,
    scoreHistory,
    subjectPerformance,
    percentile,
    writingPerformance,
  };
}

// ── GET /analytics/me ─────────────────────────────────────────────────────────

export async function getMyAnalytics(prisma: PrismaClient, studentId: string) {
  return buildStudentAnalytics(prisma, studentId);
}

// ── GET /analytics/students/:studentId ───────────────────────────────────────

export async function getStudentAnalytics(prisma: PrismaClient, studentId: string) {
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { id: true, fullName: true, profilePhotoKey: true },
  });
  if (!student) return null;

  const analytics = await buildStudentAnalytics(prisma, studentId);
  return {
    studentId:   student.id,
    studentName: decryptField(student.fullName).trim(),
    avatarUrl:   student.profilePhotoKey ?? null,
    ...analytics,
  };
}

export async function getChildrenAnalytics(prisma: PrismaClient, parentId: string) {
  const relations = await prisma.parentStudentRelation.findMany({
    where: { parentId },
    orderBy: { createdAt: "asc" },
    select: {
      student: {
        select: {
          id: true,
          fullName: true,
          profilePhotoKey: true,
        },
      },
    },
  });

  return Promise.all(
    relations.map(async ({ student }) => {
      const analytics = await buildStudentAnalytics(prisma, student.id);
      return {
        studentId: student.id,
        studentName: decryptField(student.fullName).trim(),
        avatarUrl: student.profilePhotoKey ?? null,
        ...analytics,
      };
    })
  );
}

// ── GET /analytics/leaderboard ────────────────────────────────────────────────

export async function getLeaderboard(
  prisma: PrismaClient,
  query: LeaderboardQuery,
  requestingUserId: string,
) {
  const since = periodStartDate(query.period);

  // Fetch all GRADED sessions in the period
  const sessions = await prisma.examSession.findMany({
    where: {
      status: "GRADED",
      finalScore: { not: null },
      ...(since ? { endTime: { gte: since } } : {}),
      ...(query.examId ? { examId: query.examId } : {}),
    },
    select: {
      studentId: true,
      finalScore: true,
      totalTimeSeconds: true,
      student: {
        select: { id: true, fullName: true, profilePhotoKey: true, role: true },
      },
    },
  });

  // Aggregate per student (only STUDENT role)
  const studentMap = new Map<string, {
    name: string;
    avatarUrl: string | null;
    total: number;
    count: number;
    timeTotal: number;
    timeCount: number;
  }>();

  for (const s of sessions) {
    if (s.student.role !== "STUDENT") continue;
    const score = Number(s.finalScore!);
    const entry = studentMap.get(s.studentId) ?? {
      name: decryptField(s.student.fullName).trim(),
      avatarUrl: s.student.profilePhotoKey ?? null,
      total: 0,
      count: 0,
      timeTotal: 0,
      timeCount: 0,
    };
    entry.total += score;
    entry.count += 1;
    if (typeof s.totalTimeSeconds === "number") {
      entry.timeTotal += s.totalTimeSeconds;
      entry.timeCount += 1;
    }
    studentMap.set(s.studentId, entry);
  }

  // Sort: score DESC → totalExams DESC → avgTimeSeconds ASC (faster wins ties).
  // Students without time data sort last on the time tiebreaker so they never
  // beat a student with a faster recorded time.
  const sorted = Array.from(studentMap.entries())
    .map(([studentId, v]) => ({
      studentId,
      studentName: v.name,
      avatarUrl:   v.avatarUrl,
      score:       v.count > 0 ? v.total / v.count : 0,
      totalExams:  v.count,
      avgTimeSeconds: v.timeCount > 0 ? v.timeTotal / v.timeCount : null,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.totalExams !== a.totalExams) return b.totalExams - a.totalExams;
      const aTime = a.avgTimeSeconds ?? Number.POSITIVE_INFINITY;
      const bTime = b.avgTimeSeconds ?? Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      // Fully tied — keep deterministic order by studentId so result is stable
      return a.studentId.localeCompare(b.studentId);
    });

  const ranked = sorted.map((e, i) => ({
    rank:         i + 1,
    studentId:    e.studentId,
    studentName:  e.studentName,
    avatarUrl:    e.avatarUrl,
    score:        Math.round(e.score * 10) / 10,
    rankingLevel: deriveRankingLevel(e.score),
    totalExams:   e.totalExams,
    avgTimeSeconds: e.avgTimeSeconds !== null ? Math.round(e.avgTimeSeconds) : null,
  }));

  const entries = ranked.slice(0, 10);

  // Find requesting user's rank (full entry data for outside-top-10 display)
  const myIndex = sorted.findIndex((e) => e.studentId === requestingUserId);
  const myRank = myIndex >= 0
    ? {
        ...ranked[myIndex]!,
        percentile: calculatePeerPercentile(
          sorted[myIndex]!.score,
          sorted.filter((entry) => entry.studentId !== requestingUserId).map((entry) => entry.score)
        ),
      }
    : {
        rank: null,
        studentId: requestingUserId,
        studentName: null,
        avatarUrl: null,
        score: null,
        rankingLevel: null,
        totalExams: null,
        avgTimeSeconds: null,
        percentile: null,
      };

  return { period: query.period, entries, myRank };
}
