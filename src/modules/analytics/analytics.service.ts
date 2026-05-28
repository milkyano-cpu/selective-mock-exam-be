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

function normalizeQuestionMaxMarks(maxMarks: number) {
  return Number.isFinite(maxMarks) && maxMarks > 0 ? maxMarks : 1;
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
  "tier",
  "activeSubscription",
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

  // Peer averages must use the same definition as overallAvg: avg of bestScore
  // per MOCK_EXAM from ExamAttemptSummary (per SME-92 spec).
  const peerSummaries = await prisma.examAttemptSummary.findMany({
    where: {
      studentId: { not: studentId },
      bestScore: { not: null },
      exam: { examType: "MOCK_EXAM" },
      student: { role: "STUDENT" },
    },
    select: {
      studentId: true,
      bestScore: true,
    },
  });

  const peerTotals = new Map<string, { total: number; count: number }>();
  for (const summary of peerSummaries) {
    const entry = peerTotals.get(summary.studentId) ?? { total: 0, count: 0 };
    entry.total += Number(summary.bestScore!);
    entry.count += 1;
    peerTotals.set(summary.studentId, entry);
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
  // 1. Fetch all GRADED sessions for this student and group per exam on the fly.
  //    NOTE: We intentionally DO NOT read from ExamAttemptSummary here, because
  //    that table is lazy-populated by the per-exam result page endpoint
  //    (getExamAttemptSummary) — many graded sessions never have a summary row,
  //    which would make them invisible in analytics. ExamSession is the source
  //    of truth for "did this student finish this exam".
  const gradedSessions = await prisma.examSession.findMany({
    where: { studentId, status: "GRADED" },
    orderBy: { endTime: "asc" },
    select: {
      id: true,
      examId: true,
      finalScore: true,
      rankingLevel: true,
      totalTimeSeconds: true,
      endTime: true,
      attemptNumber: true,
      exam: { select: { id: true, title: true, examType: true } },
    },
  });

  type Attempt = {
    sessionId: string;
    finalScore: number | null;
    rankingLevel: string | null;
    totalTimeSeconds: number | null;
    endTime: Date | null;
  };
  type ExamGroup = {
    examId: string;
    examTitle: string;
    examType: "MOCK_EXAM" | "ASSIGNMENT";
    attempts: Attempt[];
  };

  const examGroups = new Map<string, ExamGroup>();
  for (const s of gradedSessions) {
    const group = examGroups.get(s.examId) ?? {
      examId: s.examId,
      examTitle: s.exam.title,
      examType: s.exam.examType,
      attempts: [],
    };
    group.attempts.push({
      sessionId: s.id,
      finalScore: s.finalScore !== null ? Number(s.finalScore) : null,
      rankingLevel: s.rankingLevel ?? null,
      totalTimeSeconds: s.totalTimeSeconds ?? null,
      endTime: s.endTime,
    });
    examGroups.set(s.examId, group);
  }

  // examHistory: one entry per exam (all examTypes), with best/latest/totalAttempts.
  const examHistory = Array.from(examGroups.values())
    .map((group) => {
      const scored = group.attempts.filter((a) => a.finalScore !== null);
      if (scored.length === 0) return null;

      const best = scored.reduce((acc, a) =>
        (a.finalScore! > (acc.finalScore ?? -Infinity)) ? a : acc
      );
      const latest = group.attempts.reduce((acc, a) =>
        ((a.endTime?.getTime() ?? 0) > (acc.endTime?.getTime() ?? 0)) ? a : acc
      );

      return {
        examId:           group.examId,
        examTitle:        group.examTitle,
        examType:         group.examType,
        bestSessionId:    best.sessionId,
        bestScore:        best.finalScore,
        latestSessionId:  latest.sessionId,
        latestScore:      latest.finalScore,
        totalAttempts:    group.attempts.length,
        rankingLevel:     best.rankingLevel,
        totalTimeSeconds: best.totalTimeSeconds,
        takenAt:          latest.endTime?.toISOString() ?? new Date().toISOString(),
        // Legacy aliases — best attempt (matches the score that drives overallAvg)
        sessionId:        best.sessionId,
        finalScore:       best.finalScore,
        _sortTime:        latest.endTime?.getTime() ?? 0,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => b._sortTime - a._sortTime)
    .map(({ _sortTime: _t, ...item }) => item);

  // 2. scoreHistory: per-session, MOCK_EXAM only, chronological — used to render
  //    the score-trend line chart. Assignments are excluded so a casual tutor task
  //    can't skew the trend. Retakes remain as separate points (per spec — only
  //    overallAvg and examHistory are deduped, scoreHistory just filters by type).
  const scoreHistory = gradedSessions
    .filter((s) => s.exam.examType === "MOCK_EXAM" && s.finalScore !== null)
    .map((session) => ({
      sessionId: session.id,
      examTitle: session.exam.title,
      score: Number(session.finalScore!),
      rankingLevel: session.rankingLevel ?? null,
      takenAt: session.endTime?.toISOString() ?? new Date().toISOString(),
      attemptNumber: session.attemptNumber,
    }));

  // 3. Topic-level performance — computed on-the-fly from MOCK_EXAM answers.
  //    StudentPerformance can't be used here: it pools mock-exam and practice
  //    drills together, so a student grinding practice would appear strong on
  //    a topic they've never passed in a real exam. The table stays as-is
  //    because practice recommendations and pathways still rely on it.
  const mockExamAnswers = await prisma.studentAnswer.findMany({
    where: {
      awardedMarks: { not: null },
      session: {
        studentId,
        status: "GRADED",
        exam: { examType: "MOCK_EXAM" },
      },
    },
    select: {
      sessionId: true,
      awardedMarks: true,
      question: {
        select: {
          topicId: true,
          maxMarks: true,
          topic:   { select: { id: true, name: true } },
          subject: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Aggregate per (session, topic) first so each session contributes one
  // topic-score, mirroring the grading worker's running-average semantics.
  type TopicSessionEntry = {
    awarded: number;
    possible: number;
    topicName: string;
    subjectId: string;
    subjectName: string;
  };
  const sessionTopicMap = new Map<string, Map<string, TopicSessionEntry>>();

  for (const ans of mockExamAnswers) {
    const topicId = ans.question.topicId;
    const inner = sessionTopicMap.get(ans.sessionId) ?? new Map<string, TopicSessionEntry>();
    const entry = inner.get(topicId) ?? {
      awarded: 0,
      possible: 0,
      topicName: ans.question.topic.name,
      subjectId: ans.question.subject.id,
      subjectName: ans.question.subject.name,
    };
    entry.awarded += Number(ans.awardedMarks!);
    entry.possible += normalizeQuestionMaxMarks(ans.question.maxMarks);
    inner.set(topicId, entry);
    sessionTopicMap.set(ans.sessionId, inner);
  }

  type TopicAggregate = {
    topicName: string;
    subjectId: string;
    subjectName: string;
    scoreSum: number;
    count: number;
  };
  const topicAggregate = new Map<string, TopicAggregate>();

  for (const inner of sessionTopicMap.values()) {
    for (const [topicId, entry] of inner.entries()) {
      const topicScore = entry.possible > 0 ? (entry.awarded / entry.possible) * 100 : 0;
      const agg = topicAggregate.get(topicId) ?? {
        topicName: entry.topicName,
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        scoreSum: 0,
        count: 0,
      };
      agg.scoreSum += topicScore;
      agg.count += 1;
      topicAggregate.set(topicId, agg);
    }
  }

  const topicPerformance = Array.from(topicAggregate.entries())
    .map(([topicId, agg]) => ({
      topicId,
      topicName:    agg.topicName,
      subjectId:    agg.subjectId,
      subjectName:  agg.subjectName,
      scoreAvg:     agg.count > 0 ? agg.scoreSum / agg.count : 0,
      attemptCount: agg.count,
    }))
    .sort((a, b) => a.scoreAvg - b.scoreAvg); // weakest first

  // 4. Aggregate per subject (average of topic averages within subject)
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

  // 5. Aggregate totals.
  //    - overallAvg: avg of bestScore per MOCK_EXAM from ExamAttemptSummary
  //      (per SME-92 spec). This table is lazy-populated by the per-exam
  //      result page — exams the student hasn't opened the result for may
  //      be absent here, in which case they don't count toward overallAvg.
  //    - totalExams: count of MOCK_EXAM in examHistory (what the student has
  //      actually completed) — derived from ExamSession so it stays accurate
  //      even when ExamAttemptSummary is stale.
  //    - totalTimeSeconds: sum across all MOCK_EXAM sessions (retakes count
  //      as time invested).
  const mockExamHistoryEntries = examHistory.filter(
    (e) => e.examType === "MOCK_EXAM" && e.bestScore !== null
  );
  const totalExams = mockExamHistoryEntries.length;
  const totalTimeSeconds = gradedSessions
    .filter((s) => s.exam.examType === "MOCK_EXAM")
    .reduce((sum, s) => sum + (s.totalTimeSeconds ?? 0), 0);

  const mockExamSummaries = await prisma.examAttemptSummary.findMany({
    where: {
      studentId,
      bestScore: { not: null },
      exam: { examType: "MOCK_EXAM" },
    },
    select: { bestScore: true },
  });
  const overallAvg = mockExamSummaries.length > 0
    ? mockExamSummaries.reduce((sum, s) => sum + Number(s.bestScore!), 0) / mockExamSummaries.length
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

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

// Lightweight list of children for the parent selector. Excludes soft-deleted
// students. Full analytics is fetched lazily per-child via getChildAnalytics.
export async function getChildrenAnalytics(prisma: PrismaClient, parentId: string) {
  const relations = await prisma.parentStudentRelation.findMany({
    where: { parentId, student: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: {
      student: {
        select: {
          id: true,
          fullName: true,
          profilePhotoKey: true,
          tier: true,
          subscriptions: {
            orderBy: { currentPeriodEnd: "desc" },
            select: {
              id: true,
              tier: true,
              status: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
            },
          },
        },
      },
    },
  });

  const now = new Date();

  return relations.map(({ student }) => {
    const activeSubscription = student.subscriptions.find(
      (sub) => ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status) && sub.currentPeriodEnd > now
    );
    return {
      studentId: student.id,
      studentName: decryptField(student.fullName).trim(),
      avatarUrl: student.profilePhotoKey ?? null,
      tier: student.tier,
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            tier: activeSubscription.tier,
            status: activeSubscription.status,
            currentPeriodEnd: activeSubscription.currentPeriodEnd.toISOString(),
            cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
          }
        : null,
    };
  });
}

// Per-child analytics for parent. Verifies relation (and excludes soft-deleted
// students), then builds full analytics for tier-gated serialization.
export async function getChildAnalyticsForParent(
  prisma: PrismaClient,
  parentId: string,
  studentId: string
) {
  const relation = await prisma.parentStudentRelation.findFirst({
    where: {
      parentId,
      studentId,
      student: { deletedAt: null },
    },
    select: {
      student: {
        select: {
          id: true,
          fullName: true,
          profilePhotoKey: true,
          tier: true,
        },
      },
    },
  });

  if (!relation) return null;
  const { student } = relation;

  const analytics = await buildStudentAnalytics(prisma, student.id);
  return {
    studentId: student.id,
    studentName: decryptField(student.fullName).trim(),
    avatarUrl: student.profilePhotoKey ?? null,
    tier: student.tier,
    ...analytics,
  };
}

// ── GET /analytics/leaderboard ────────────────────────────────────────────────

const LEADERBOARD_THRESHOLD_KEY = "leaderboard_min_exams_threshold";
const LEADERBOARD_THRESHOLD_FALLBACK = 3;

async function getLeaderboardMinExamsThreshold(prisma: PrismaClient): Promise<number> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: LEADERBOARD_THRESHOLD_KEY },
  });
  const parsed = setting ? parseInt(setting.value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : LEADERBOARD_THRESHOLD_FALLBACK;
}

export async function getLeaderboard(
  prisma: PrismaClient,
  query: LeaderboardQuery,
  requestingUserId: string,
) {
  const since = periodStartDate(query.period);
  const minExamsThreshold = await getLeaderboardMinExamsThreshold(prisma);

  // Fetch all GRADED MOCK_EXAM sessions in the period.
  // ASSIGNMENT sessions are excluded so tutor assignments don't affect ranking.
  const sessions = await prisma.examSession.findMany({
    where: {
      status: "GRADED",
      finalScore: { not: null },
      exam: { examType: "MOCK_EXAM" },
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

  // Sort: rankScore DESC → totalExams DESC → avgTimeSeconds ASC (faster wins ties).
  // rankScore = avgScore × min(totalExams / threshold, 1) — students below the
  // exam threshold get a proportionally reduced weight so a single perfect score
  // can't dominate the top ranks. The raw avgScore is still exposed in the response.
  const sorted = Array.from(studentMap.entries())
    .map(([studentId, v]) => {
      const score = v.count > 0 ? v.total / v.count : 0;
      const weight = Math.min(v.count / minExamsThreshold, 1);
      return {
        studentId,
        studentName: v.name,
        avatarUrl:   v.avatarUrl,
        score,
        rankScore:   score * weight,
        totalExams:  v.count,
        avgTimeSeconds: v.timeCount > 0 ? v.timeTotal / v.timeCount : null,
      };
    })
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
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

  // Percentile is based on rankScore so it stays consistent with the rank position.
  const myIndex = sorted.findIndex((e) => e.studentId === requestingUserId);
  const myRank = myIndex >= 0
    ? {
        ...ranked[myIndex]!,
        percentile: calculatePeerPercentile(
          sorted[myIndex]!.rankScore,
          sorted.filter((entry) => entry.studentId !== requestingUserId).map((entry) => entry.rankScore)
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
