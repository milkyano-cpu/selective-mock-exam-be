import type { PrismaClient } from "@prisma/client";
import type { LeaderboardQuery } from "./analytics.schema.js";

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
  if (avg >= 90) return "SUPERIOR";
  if (avg >= 75) return "ABOVE_AVERAGE";
  if (avg >= 60) return "HIGH_AVERAGE";
  if (avg >= 45) return "AVERAGE";
  return "LOW_AVERAGE";
}

// ── Shared: build analytics payload for a given studentId ────────────────────

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
  const subjectPerformance = Array.from(subjectMap.entries()).map(([subjectId, v]) => ({
    subjectId,
    subjectName: v.name,
    scoreAvg:    v.count > 0 ? v.total / v.count : 0,
    topicCount:  v.count,
  }));

  // 4. Aggregate totals
  const totalExams = sessions.length;
  const totalTimeSeconds = sessions.reduce((sum, s) => sum + (s.totalTimeSeconds ?? 0), 0);
  const scoredSessions = sessions.filter((s) => s.finalScore !== null);
  const overallAvg = scoredSessions.length > 0
    ? scoredSessions.reduce((sum, s) => sum + Number(s.finalScore!), 0) / scoredSessions.length
    : null;
  const rankingLevel = overallAvg !== null ? deriveRankingLevel(overallAvg) : null;

  return { overallAvg, totalExams, totalTimeSeconds, rankingLevel, examHistory, topicPerformance, subjectPerformance };
}

// ── GET /analytics/me ─────────────────────────────────────────────────────────

export async function getMyAnalytics(prisma: PrismaClient, studentId: string) {
  return buildStudentAnalytics(prisma, studentId);
}

// ── GET /analytics/students/:studentId ───────────────────────────────────────

export async function getStudentAnalytics(prisma: PrismaClient, studentId: string) {
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { id: true, firstName: true, lastName: true, profilePhoto: true },
  });
  if (!student) return null;

  const analytics = await buildStudentAnalytics(prisma, studentId);
  return {
    studentId:   student.id,
    studentName: `${student.firstName} ${student.lastName}`.trim(),
    avatarUrl:   student.profilePhoto ?? null,
    ...analytics,
  };
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
    },
    select: {
      studentId: true,
      finalScore: true,
      student: {
        select: { id: true, firstName: true, lastName: true, profilePhoto: true, role: true },
      },
    },
  });

  // Aggregate per student (only STUDENT role)
  const studentMap = new Map<string, {
    name: string;
    avatarUrl: string | null;
    total: number;
    count: number;
  }>();

  for (const s of sessions) {
    if (s.student.role !== "STUDENT") continue;
    const score = Number(s.finalScore!);
    const entry = studentMap.get(s.studentId) ?? {
      name: `${s.student.firstName} ${s.student.lastName}`.trim(),
      avatarUrl: s.student.profilePhoto ?? null,
      total: 0,
      count: 0,
    };
    entry.total += score;
    entry.count += 1;
    studentMap.set(s.studentId, entry);
  }

  // Sort by avg desc → assign rank
  const sorted = Array.from(studentMap.entries())
    .map(([studentId, v]) => ({
      studentId,
      studentName: v.name,
      avatarUrl:   v.avatarUrl,
      score:       v.count > 0 ? v.total / v.count : 0,
      totalExams:  v.count,
    }))
    .sort((a, b) => b.score - a.score);

  const entries = sorted.slice(0, 50).map((e, i) => ({
    rank:         i + 1,
    studentId:    e.studentId,
    studentName:  e.studentName,
    avatarUrl:    e.avatarUrl,
    score:        Math.round(e.score * 10) / 10,
    rankingLevel: deriveRankingLevel(e.score),
    totalExams:   e.totalExams,
  }));

  // Find requesting user's rank
  const myIndex = sorted.findIndex((e) => e.studentId === requestingUserId);
  const myEntry = myIndex >= 0 ? sorted[myIndex] : undefined;
  const myRank = myEntry
    ? { rank: myIndex + 1, score: Math.round(myEntry.score * 10) / 10 }
    : { rank: null, score: null };

  return { period: query.period, entries, myRank };
}
