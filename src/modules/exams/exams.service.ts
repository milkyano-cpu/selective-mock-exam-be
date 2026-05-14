import type { Prisma, PrismaClient } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";
import { decryptField } from "../../utils/field-encryption.js";
import { createNotification } from "../../lib/notify.js";
import { generateSessionInsightsWithAi } from "../../utils/ai-insights.js";
import {
  IMAGE_SUMMARY_SELECT,
  serializeImageSummary,
  type ImageSummaryRecord,
} from "../images/images.service.js";
import type {
  CreateExamBody,
  UpdateExamBody,
  ListExamsQuery,
  PublishExamBody,
  AddExamQuestionsBody,
  SubmitAnswerBody,
  BatchAnswersBody,
  SubmitSessionBody,
  SessionHeartbeatBody,
  ListSessionsQuery,
  ExamSubmissionsQuery,
  SubmitManualGradesBody,
  StartRetakeBody,
} from "./exams.schema.js";

type SessionAnswerReviewStatus = "NOT_APPLICABLE" | "AI_GRADED" | "PENDING_REVIEW" | "MANUAL_GRADED";
type ExamGradingType = "AUTO" | "MANUAL";
const MANUAL_SCORE_CORRECT_THRESHOLD = 50;

function calculateRankingLevel(
  score: number
): "SUPERIOR" | "ABOVE_AVERAGE" | "HIGH_AVERAGE" | "AVERAGE" | "LOW_AVERAGE" {
  if (score >= 90) return "SUPERIOR";
  if (score >= 75) return "ABOVE_AVERAGE";
  if (score >= 60) return "HIGH_AVERAGE";
  if (score >= 45) return "AVERAGE";
  return "LOW_AVERAGE";
}


function normalizeQuestionMaxMarks(maxMarks: number) {
  return Number.isFinite(maxMarks) && maxMarks > 0 ? maxMarks : 1;
}

function scorePercentToAwardedMarks(scorePercent: number, maxMarks: number) {
  const boundedPercent = Math.min(100, Math.max(0, scorePercent));
  return Number(((boundedPercent / 100) * maxMarks).toFixed(2));
}

function isAwardedMarksCorrect(awardedMarks: number, maxMarks: number) {
  return maxMarks > 0 && (awardedMarks / maxMarks) * 100 >= MANUAL_SCORE_CORRECT_THRESHOLD;
}

function normalizeTutorFeedback(feedback: string | null | undefined) {
  const value = feedback?.trim();
  return value ? value : null;
}

function normalizeExamGradingType(gradingType: string): ExamGradingType {
  return gradingType === "MANUAL" ? "MANUAL" : "AUTO";
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function getDurationSeconds(durationMinutes: number) {
  return Math.max(0, durationMinutes * 60);
}

function getSessionExpiresAt(
  startTime: Date,
  durationMinutes: number,
  expiresAt?: Date | null
) {
  return expiresAt ?? addSeconds(startTime, getDurationSeconds(durationMinutes));
}

function getSecondsRemaining(expiresAt: Date, now = new Date()) {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

function getElapsedSessionSeconds(startTime: Date, expiresAt: Date, now = new Date()) {
  const boundedEnd = now.getTime() > expiresAt.getTime() ? expiresAt : now;
  return Math.max(0, Math.floor((boundedEnd.getTime() - startTime.getTime()) / 1000));
}

function isSessionExpired(expiresAt: Date, now = new Date()) {
  return now.getTime() >= expiresAt.getTime();
}

function clampDeltaSeconds(value: number | null | undefined) {
  if (!Number.isFinite(value ?? 0)) return 0;
  return Math.max(0, Math.min(300, Math.floor(value ?? 0)));
}

function getNextTimeSpentSeconds(
  existingSeconds: number,
  reportedTotalSeconds: number,
  deltaSeconds = 0
) {
  return Math.max(
    existingSeconds,
    reportedTotalSeconds,
    existingSeconds + clampDeltaSeconds(deltaSeconds)
  );
}

async function ensureSessionExpiresAt(
  prisma: PrismaClient,
  session: { id: string; startTime: Date; expiresAt: Date | null },
  durationMinutes: number
) {
  const expiresAt = getSessionExpiresAt(session.startTime, durationMinutes, session.expiresAt);
  if (!session.expiresAt) {
    await prisma.examSession.update({
      where: { id: session.id },
      data: { expiresAt },
    });
  }
  return expiresAt;
}

function assertSessionCanAcceptWork(expiresAt: Date, now = new Date()) {
  if (isSessionExpired(expiresAt, now)) {
    throw createHttpError(409, "Exam time has expired");
  }
}

async function assertQuestionBelongsToExam(
  prisma: PrismaClient,
  examId: string,
  questionId: string
) {
  const examQuestion = await prisma.examQuestion.findUnique({
    where: { examId_questionId: { examId, questionId } },
    select: { questionId: true },
  });
  if (!examQuestion) throw createHttpError(404, "Question not found in this exam");
}

function serializeAiFeedback(aiFeedback: unknown) {
  if (!aiFeedback || typeof aiFeedback !== "object" || Array.isArray(aiFeedback)) return null;

  const value = aiFeedback as Record<string, unknown>;
  const confidence = value.confidence;
  const aiRubric = value.aiRubric;
  const criterionScores = Array.isArray(value.criterionScores)
    ? value.criterionScores
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const score = item as Record<string, unknown>;
          return {
            criterionId: typeof score.criterionId === "string" ? score.criterionId : "",
            criterionName: typeof score.criterionName === "string" ? score.criterionName : "",
            score: typeof score.score === "number" ? score.score : 0,
            maxScore: typeof score.maxScore === "number" ? score.maxScore : 0,
            feedback: typeof score.feedback === "string" ? score.feedback : "",
          };
        })
        .filter((item): item is { criterionId: string; criterionName: string; score: number; maxScore: number; feedback: string } => item !== null && Boolean(item.criterionId))
    : [];

  return {
    isCorrect: typeof value.isCorrect === "boolean" ? value.isCorrect : null,
    confidence:
      confidence === "high" || confidence === "medium" || confidence === "low"
        ? confidence
        : null,
    feedback: typeof value.feedback === "string" ? value.feedback : null,
    pendingReview: typeof value.pendingReview === "boolean" ? value.pendingReview : null,
    reason: typeof value.reason === "string" ? value.reason : null,
    gradedAt: typeof value.gradedAt === "string" ? value.gradedAt : null,
    aiRubric: aiRubric && typeof aiRubric === "object" && !Array.isArray(aiRubric)
      ? {
          id: typeof (aiRubric as Record<string, unknown>).id === "string" ? (aiRubric as Record<string, unknown>).id as string : "",
          name: typeof (aiRubric as Record<string, unknown>).name === "string" ? (aiRubric as Record<string, unknown>).name as string : "",
          totalMaxScore: typeof (aiRubric as Record<string, unknown>).totalMaxScore === "number" ? (aiRubric as Record<string, unknown>).totalMaxScore as number : 0,
        }
      : null,
    criterionScores,
    totalAwardedMarks: typeof value.totalAwardedMarks === "number" ? value.totalAwardedMarks : null,
    totalPossibleMarks: typeof value.totalPossibleMarks === "number" ? value.totalPossibleMarks : null,
    scorePercent: typeof value.scorePercent === "number" ? value.scorePercent : null,
  };
}

function getAnswerReviewStatus(params: {
  type: "MCQ" | "ESSAY";
  gradingType: ExamGradingType;
  studentAnswer: string;
  manualScore: number | null;
  aiFeedback: ReturnType<typeof serializeAiFeedback>;
}): SessionAnswerReviewStatus {
  if (params.type !== "ESSAY") return "NOT_APPLICABLE";
  if (!params.studentAnswer.trim()) return "NOT_APPLICABLE";
  if (params.gradingType === "MANUAL" && params.manualScore === null) return "PENDING_REVIEW";
  if (params.manualScore !== null) return "MANUAL_GRADED";
  if (params.aiFeedback?.pendingReview) return "PENDING_REVIEW";
  if (params.aiFeedback) return "AI_GRADED";
  return "PENDING_REVIEW";
}

function evaluateSessionOutcome(params: {
  gradingType: ExamGradingType;
  examQuestions: Array<{
    questionId: string;
    question: {
      id: string;
      type: "MCQ" | "ESSAY";
      correctAnswer: string;
      maxMarks: number;
    };
  }>;
  answerMap: Map<
    string,
    {
      studentAnswer: string;
      isCorrect?: boolean;
      manualScore?: number | null;
      awardedMarks?: number | null;
      aiFeedback?: unknown;
    }
  >;
}) {
  let pendingReviewCount = 0;
  let correctCount = 0;
  let totalAwardedMarks = 0;
  let totalPossibleMarks = 0;

  for (const eq of params.examQuestions) {
    const answer = params.answerMap.get(eq.questionId);
    const studentAnswer = answer?.studentAnswer ?? "";
    const manualScore = answer?.manualScore ?? null;
    const aiFeedback = serializeAiFeedback(answer?.aiFeedback ?? null);
    const maxMarks = normalizeQuestionMaxMarks(eq.question.maxMarks);
    totalPossibleMarks += maxMarks;

    if (eq.question.type === "MCQ") {
      const isCorrect =
        studentAnswer.trim().toUpperCase() === eq.question.correctAnswer.trim().toUpperCase();
      totalAwardedMarks += isCorrect ? maxMarks : 0;
      if (isCorrect) correctCount++;
      continue;
    }

    if (params.gradingType === "MANUAL") {
      if (studentAnswer.trim() && manualScore === null) {
        pendingReviewCount++;
        continue;
      }

      const awardedMarks = manualScore ?? 0;
      totalAwardedMarks += Math.min(maxMarks, Math.max(0, awardedMarks));
      if (isAwardedMarksCorrect(awardedMarks, maxMarks)) correctCount++;
      continue;
    }

    if (manualScore !== null) {
      totalAwardedMarks += Math.min(maxMarks, Math.max(0, manualScore));
      if (isAwardedMarksCorrect(manualScore, maxMarks)) correctCount++;
      continue;
    }

    if (aiFeedback?.pendingReview) {
      pendingReviewCount++;
      continue;
    }

    if (!studentAnswer.trim()) {
      continue;
    }

    if (aiFeedback) {
      const scorePercent = aiFeedback.scorePercent ?? (aiFeedback.isCorrect ? 100 : 0);
      totalAwardedMarks += scorePercentToAwardedMarks(scorePercent, maxMarks);
      if (aiFeedback.isCorrect) correctCount++;
      continue;
    }

    pendingReviewCount++;
  }

  if (pendingReviewCount > 0) {
    return {
      status: "SUBMITTED" as const,
      finalScore: null,
      rankingLevel: null,
      pendingReviewCount,
      correctCount,
    };
  }

  const finalScore = totalPossibleMarks > 0 ? (totalAwardedMarks / totalPossibleMarks) * 100 : 0;

  return {
    status: "GRADED" as const,
    finalScore,
    rankingLevel: calculateRankingLevel(finalScore),
    pendingReviewCount,
    correctCount,
  };
}

// ── Select shapes ─────────────────────────────────────────────────────────────

const EXAM_SELECT = {
  id: true,
  title: true,
  examType: true,
  durationMinutes: true,
  gradingType: true,
  status: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { fullName: true } },
  _count: { select: { questions: true, sessions: true } },
} as const;

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeExam(exam: {
  id: string;
  title: string;
  examType: string;
  durationMinutes: number | null;
  gradingType: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  creator: { fullName: string };
  _count: { questions: number; sessions?: number };
}) {
  return {
    id: exam.id,
    title: exam.title,
    examType: exam.examType as "MOCK_EXAM" | "ASSIGNMENT",
    durationMinutes: exam.durationMinutes,
    gradingType: normalizeExamGradingType(exam.gradingType),
    status: exam.status as "DRAFT" | "PUBLISHED",
    createdBy: exam.createdBy,
    creatorName: decryptField(exam.creator.fullName),
    questionCount: exam._count.questions,
    hasSessions: (exam._count.sessions ?? 0) > 0,
    createdAt: exam.createdAt.toISOString(),
    updatedAt: exam.updatedAt.toISOString(),
  };
}

// ── Exam CRUD ─────────────────────────────────────────────────────────────────

export async function createExamRecord(
  prisma: PrismaClient,
  createdBy: string,
  body: CreateExamBody
) {
  const exam = await prisma.exam.create({
    data: {
      title: body.title,
      examType: body.examType,
      durationMinutes: body.durationMinutes,
      gradingType: body.gradingType,
      createdBy,
    },
    select: EXAM_SELECT,
  });
  return serializeExam(exam);
}

export async function listExams(prisma: PrismaClient, query: ListExamsQuery, role?: string) {
  const { page, limit, examType } = query;
  const skip = (page - 1) * limit;

  const where = {
    ...(examType ? { examType } : {}),
    ...(role === "STUDENT" ? { status: "PUBLISHED" as const } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.exam.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: EXAM_SELECT,
    }),
    prisma.exam.count({ where }),
  ]);

  return {
    data: items.map(serializeExam),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function findExamById(prisma: PrismaClient, examId: string) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: EXAM_SELECT,
  });
  if (!exam) throw createHttpError(404, "Exam not found");
  return serializeExam(exam);
}

export async function updateExamRecord(
  prisma: PrismaClient,
  examId: string,
  body: UpdateExamBody
) {
  const exam = await prisma.exam.findUnique({ 
    where: { id: examId }, 
    select: { id: true, gradingType: true, _count: { select: { sessions: true } } } 
  });
  if (!exam) throw createHttpError(404, "Exam not found");

  if (exam._count.sessions > 0) {
    throw createHttpError(422, "Cannot edit an exam that has already been taken by students");
  }

  if (body.gradingType === "MANUAL" && exam.gradingType !== "MANUAL") {
    const hasNonEssay = await prisma.examQuestion.findFirst({
      where: {
        examId,
        question: { type: { not: "ESSAY" } },
      },
    });
    if (hasNonEssay) {
      throw createHttpError(422, "Cannot change grading type to MANUAL because the exam contains non-ESSAY questions");
    }
  }

  const updated = await prisma.exam.update({
    where: { id: examId },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.examType !== undefined && { examType: body.examType }),
      ...(body.durationMinutes !== undefined && { durationMinutes: body.durationMinutes }),
      ...(body.gradingType !== undefined && { gradingType: body.gradingType }),
    },
    select: EXAM_SELECT,
  });
  return serializeExam(updated);
}

export async function deleteExamRecord(prisma: PrismaClient, examId: string) {
  const exam = await prisma.exam.findUnique({ 
    where: { id: examId }, 
    select: { id: true, _count: { select: { sessions: true } } } 
  });
  if (!exam) throw createHttpError(404, "Exam not found");
  if (exam._count.sessions > 0) {
    throw createHttpError(422, "Cannot delete an exam that has already been taken by students");
  }
  await prisma.exam.delete({ where: { id: examId } });
}

export async function publishExamRecord(
  prisma: PrismaClient,
  examId: string,
  body: PublishExamBody
) {
  const exam = await prisma.exam.findUnique({ 
    where: { id: examId }, 
    select: { id: true, status: true, durationMinutes: true, gradingType: true } 
  });
  if (!exam) throw createHttpError(404, "Exam not found");

  if (exam.status === "PUBLISHED" && body.status === "DRAFT") {
    throw createHttpError(422, "Published exams cannot be moved back to draft");
  }

  // VALIDATION: If publishing, check if all questions are APPROVED (PUBLISHED)
  if (body.status === "PUBLISHED") {
    const effectiveDurationMinutes = body.durationMinutes ?? exam.durationMinutes;
    const effectiveGradingType = body.gradingType ?? exam.gradingType;

    if (effectiveDurationMinutes === null || effectiveDurationMinutes === undefined) {
      throw createHttpError(422, "Cannot publish exam without duration minutes");
    }

    if (effectiveGradingType === null || effectiveGradingType === undefined) {
      throw createHttpError(422, "Cannot publish exam without grading type");
    }

    const examQuestions = await prisma.examQuestion.findMany({
      where: { examId },
      include: { question: { select: { status: true, questionId: true } } },
    });

    if (examQuestions.length === 0) {
      throw createHttpError(422, "Cannot publish an exam with no questions");
    }

    const unapproved = examQuestions.filter((eq) => eq.question.status !== "PUBLISHED");
    if (unapproved.length > 0) {
      const ids = unapproved.map((eq) => eq.question.questionId || "Unknown ID").join(", ");
      throw createHttpError(
        422, 
        `Cannot publish exam. The following questions are not approved: ${ids}`
      );
    }
  }

  const updated = await prisma.exam.update({
    where: { id: examId },
    data: { 
      status: body.status,
      ...(body.durationMinutes !== undefined && { durationMinutes: body.durationMinutes }),
      ...(body.gradingType !== undefined && { gradingType: body.gradingType }),
    },
    select: EXAM_SELECT,
  });
  return serializeExam(updated);
}

// ── Exam Questions ────────────────────────────────────────────────────────────

function serializeExamQuestion(eq: {
  examId: string;
  questionId: string;
  order: number;
  question: {
    id: string;
    questionId: string | null;
    type: string;
    difficulty: string;
    questionText: string;
    latexEnabled: boolean;
    options: unknown;
    correctAnswer: string;
    imageUrl: string | null;
    imageRef: string | null;
    image: ImageSummaryRecord | null;
    imageUrls: string[];
    subject: { name: string };
    topic: { name: string };
  };
}) {
  return {
    examId: eq.examId,
    questionId: eq.questionId,
    order: eq.order,
    question: {
      id: eq.question.id,
      questionId: eq.question.questionId,
      type: eq.question.type as "MCQ" | "ESSAY",
      difficulty: eq.question.difficulty as "EASY" | "MEDIUM" | "HARD",
      questionText: eq.question.questionText,
      latexEnabled: eq.question.latexEnabled,
      options: eq.question.options as Array<{ key: string; text: string }> | null,
      correctAnswer: eq.question.correctAnswer,
      imageRef: eq.question.imageRef,
      image: serializeImageSummary(eq.question.image),
      imageUrl: eq.question.imageUrl,
      imageUrls: eq.question.imageUrls,
      subjectName: eq.question.subject.name,
      topicName: eq.question.topic.name,
    },
  };
}

const EXAM_QUESTION_SELECT = {
  examId: true,
  questionId: true,
  order: true,
  question: {
    select: {
      id: true,
      questionId: true,
      type: true,
      difficulty: true,
      questionText: true,
      latexEnabled: true,
      options: true,
      correctAnswer: true,
      imageRef: true,
      image: { select: IMAGE_SUMMARY_SELECT },
      imageUrl: true,
      imageUrls: true,
      subject: { select: { name: true } },
      topic: { select: { name: true } },
    },
  },
} as const;

export async function getExamWithQuestions(prisma: PrismaClient, examId: string) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: EXAM_SELECT,
  });
  if (!exam) throw createHttpError(404, "Exam not found");

  const questions = await prisma.examQuestion.findMany({
    where: { examId },
    orderBy: { order: "asc" },
    select: EXAM_QUESTION_SELECT,
  });

  return {
    exam: serializeExam(exam),
    questions: questions.map(serializeExamQuestion),
  };
}

export async function addQuestionsToExam(
  prisma: PrismaClient,
  examId: string,
  body: AddExamQuestionsBody
) {
  const exam = await prisma.exam.findUnique({ 
    where: { id: examId }, 
    select: { id: true, gradingType: true, _count: { select: { sessions: true } } } 
  });
  if (!exam) throw createHttpError(404, "Exam not found");
  if (exam._count.sessions > 0) {
    throw createHttpError(422, "Cannot add questions to an exam that has already been taken by students");
  }

  // Verify all questions exist and are published
  const questions = await prisma.question.findMany({
    where: { id: { in: body.questionIds }, status: "PUBLISHED" },
    select: { id: true, type: true },
  });

  if (questions.length !== body.questionIds.length) {
    throw createHttpError(
      422,
      "Some questions were not found or are not in PUBLISHED status"
    );
  }

  if (exam.gradingType === "MANUAL") {
    const hasNonEssay = questions.some(q => q.type !== "ESSAY");
    if (hasNonEssay) {
      throw createHttpError(422, "Exams with MANUAL grading type can only contain ESSAY questions");
    }
  }

  // Find which questionIds are not already in this exam
  const existing = await prisma.examQuestion.findMany({
    where: { examId, questionId: { in: body.questionIds } },
    select: { questionId: true },
  });
  const existingIds = new Set(existing.map((e) => e.questionId));
  const newIds = body.questionIds.filter((id) => !existingIds.has(id));

  if (newIds.length === 0) {
    throw createHttpError(409, "All provided questions are already in this exam");
  }

  // Get current max order
  const maxOrderResult = await prisma.examQuestion.aggregate({
    where: { examId },
    _max: { order: true },
  });
  const startOrder = (maxOrderResult._max.order ?? 0) + 1;

  await prisma.examQuestion.createMany({
    data: newIds.map((questionId, index) => ({
      examId,
      questionId,
      order: startOrder + index,
    })),
    skipDuplicates: true,
  });

  const updated = await prisma.examQuestion.findMany({
    where: { examId },
    orderBy: { order: "asc" },
    select: EXAM_QUESTION_SELECT,
  });
  return updated.map(serializeExamQuestion);
}

export async function removeQuestionFromExam(
  prisma: PrismaClient,
  examId: string,
  questionId: string
) {
  const examQuestion = await prisma.examQuestion.findUnique({
    where: { examId_questionId: { examId, questionId } },
    select: { exam: { select: { _count: { select: { sessions: true } } } } },
  });
  if (!examQuestion) throw createHttpError(404, "Question not found in this exam");
  if (examQuestion.exam._count.sessions > 0) {
    throw createHttpError(422, "Cannot remove questions from an exam that has already been taken by students");
  }
  await prisma.examQuestion.delete({ where: { examId_questionId: { examId, questionId } } });
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function startOrResumeSession(
  prisma: PrismaClient,
  examId: string,
  studentId: string
) {
  const now = new Date();
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      durationMinutes: true,
      gradingType: true,
      questions: {
        orderBy: { order: "asc" },
        select: {
          questionId: true,
          order: true,
          question: {
            select: {
              id: true,
              type: true,
              questionText: true,
              latexEnabled: true,
              options: true,
              imageUrl: true,
              imageRef: true,
              image: { select: IMAGE_SUMMARY_SELECT },
              imageUrls: true,
              subject: { select: { name: true } },
              topic: { select: { name: true } },
              passage: {
                select: {
                  id: true,
                  title: true,
                  content: true,
                  imageRef: true,
                  image: { select: IMAGE_SUMMARY_SELECT },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!exam) throw createHttpError(404, "Exam not found");
  if (exam.questions.length === 0) throw createHttpError(422, "Exam has no questions");
  if (exam.durationMinutes === null || exam.durationMinutes === undefined) {
    throw createHttpError(422, "Exam duration has not been set");
  }

  // Check for existing in-progress session (allow resume)
  let session = await prisma.examSession.findFirst({
    where: { examId, studentId, status: "IN_PROGRESS" },
    select: {
      id: true,
      status: true,
      startTime: true,
      expiresAt: true,
      activeTimeSeconds: true,
      idleTimeSeconds: true,
    },
  });

  if (!session) {
    // Prevent retake of completed sessions
    const completed = await prisma.examSession.findFirst({
      where: { examId, studentId, status: { in: ["SUBMITTED", "GRADED"] } },
      select: { id: true },
    });
    if (completed) {
      throw createHttpError(409, "You have already submitted this exam");
    }

    session = await prisma.examSession.create({
      data: {
        examId,
        studentId,
        status: "IN_PROGRESS",
        startTime: now,
        expiresAt: addSeconds(now, getDurationSeconds(exam.durationMinutes)),
        lastActivityAt: now,
        lastHeartbeatAt: now,
      },
      select: {
        id: true,
        status: true,
        startTime: true,
        expiresAt: true,
        activeTimeSeconds: true,
        idleTimeSeconds: true,
      },
    });
  }

  const expiresAt = await ensureSessionExpiresAt(prisma, session, exam.durationMinutes);

  // Get existing answers for resume support
  const existingAnswers = await prisma.studentAnswer.findMany({
    where: { sessionId: session.id },
    select: { questionId: true, studentAnswer: true, timeSpentSeconds: true },
  });
  const answerMap = new Map(existingAnswers.map((a) => [a.questionId, a]));

  const questions = exam.questions.map((eq) => ({
    questionId: eq.questionId,
    order: eq.order,
    type: eq.question.type as "MCQ" | "ESSAY",
    questionText: eq.question.questionText,
    latexEnabled: eq.question.latexEnabled,
    options: eq.question.options as Array<{ key: string; text: string }> | null,
    imageRef: eq.question.imageRef,
    image: serializeImageSummary(eq.question.image),
    imageUrl: eq.question.imageUrl,
    imageUrls: eq.question.imageUrls,
    subjectName: eq.question.subject.name,
    topicName: eq.question.topic.name,
    passage: eq.question.passage
      ? {
          id: eq.question.passage.id,
          title: eq.question.passage.title,
          content: eq.question.passage.content,
          imageRef: eq.question.passage.imageRef,
          image: serializeImageSummary(eq.question.passage.image),
        }
      : null,
    existingAnswer: answerMap.has(eq.questionId)
      ? {
          studentAnswer: answerMap.get(eq.questionId)!.studentAnswer,
          timeSpentSeconds: answerMap.get(eq.questionId)!.timeSpentSeconds,
        }
      : null,
  }));

  return {
    sessionId: session.id,
    examId: exam.id,
    examTitle: exam.title,
    durationMinutes: exam.durationMinutes,
    gradingType: normalizeExamGradingType(exam.gradingType),
    status: session.status as "IN_PROGRESS",
    startTime: session.startTime.toISOString(),
    expiresAt: expiresAt.toISOString(),
    serverNow: now.toISOString(),
    secondsRemaining: getSecondsRemaining(expiresAt, now),
    activeTimeSeconds: session.activeTimeSeconds,
    idleTimeSeconds: session.idleTimeSeconds,
    questions,
    answeredCount: existingAnswers.filter((answer) => answer.studentAnswer.trim()).length,
  };
}

export async function startRetakeSession(
  prisma: PrismaClient,
  examId: string,
  studentId: string,
  body: StartRetakeBody
) {
  const now = new Date();
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      durationMinutes: true,
      gradingType: true,
      questions: {
        orderBy: { order: "asc" },
        select: {
          questionId: true,
          order: true,
          question: {
            select: {
              id: true,
              type: true,
              questionText: true,
              latexEnabled: true,
              options: true,
              imageUrl: true,
              imageRef: true,
              image: { select: IMAGE_SUMMARY_SELECT },
              imageUrls: true,
              subjectId: true,
              subject: { select: { name: true } },
              topic: { select: { name: true } },
              passage: {
                select: {
                  id: true,
                  title: true,
                  content: true,
                  imageRef: true,
                  image: { select: IMAGE_SUMMARY_SELECT },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!exam) throw createHttpError(404, "Exam not found");
  if (exam.questions.length === 0) throw createHttpError(422, "Exam has no questions");
  if (exam.durationMinutes === null || exam.durationMinutes === undefined) {
    throw createHttpError(422, "Exam duration has not been set");
  }

  // Check for existing in-progress retake session (allow resume)
  const inProgress = await prisma.examSession.findFirst({
    where: { examId, studentId, status: "IN_PROGRESS" },
    select: {
      id: true,
      status: true,
      startTime: true,
      expiresAt: true,
      activeTimeSeconds: true,
      idleTimeSeconds: true,
      retakeQuestionIds: true,
      attemptNumber: true,
      retakeMode: true,
    },
  });

  if (inProgress) {
    throw createHttpError(409, "You have an exam session in progress. Please complete or submit it first.");
  }

  // Student must have at least one completed session
  const completedSessions = await prisma.examSession.findMany({
    where: { examId, studentId, status: { in: ["SUBMITTED", "GRADED"] } },
    orderBy: { startTime: "asc" },
    select: { id: true, attemptNumber: true },
  });
  if (completedSessions.length === 0) {
    throw createHttpError(422, "You must complete the exam at least once before retaking it");
  }

  const nextAttemptNumber = Math.max(...completedSessions.map((s) => s.attemptNumber)) + 1;

  // Determine which questions to include based on retake mode
  let retakeQuestionIds: string[] = [];

  if (body.mode === "FULL") {
    retakeQuestionIds = [];
  } else if (body.mode === "INCORRECT_ONLY") {
    if (!body.sourceSessionId) {
      throw createHttpError(400, "sourceSessionId is required for INCORRECT_ONLY retake");
    }
    const sourceSession = await prisma.examSession.findUnique({
      where: { id: body.sourceSessionId },
      select: {
        studentId: true,
        examId: true,
        status: true,
        answers: {
          select: { questionId: true, isCorrect: true, studentAnswer: true },
        },
      },
    });
    if (!sourceSession) throw createHttpError(404, "Source session not found");
    if (sourceSession.studentId !== studentId) throw createHttpError(403, "Forbidden");
    if (sourceSession.examId !== examId) throw createHttpError(400, "Source session does not belong to this exam");
    if (sourceSession.status === "IN_PROGRESS") {
      throw createHttpError(400, "Source session has not been submitted yet");
    }

    retakeQuestionIds = sourceSession.answers
      .filter((a) => !a.isCorrect)
      .map((a) => a.questionId);

    if (retakeQuestionIds.length === 0) {
      throw createHttpError(422, "No incorrect questions found in the source session");
    }
  } else if (body.mode === "SUBJECT_ONLY") {
    if (!body.subjectId) {
      throw createHttpError(400, "subjectId is required for SUBJECT_ONLY retake");
    }
    retakeQuestionIds = exam.questions
      .filter((eq) => eq.question.subjectId === body.subjectId)
      .map((eq) => eq.questionId);

    if (retakeQuestionIds.length === 0) {
      throw createHttpError(422, "No questions found for the specified subject in this exam");
    }
  }

  const retakeQuestionSet = new Set(retakeQuestionIds);
  const isSubset = retakeQuestionIds.length > 0;

  const session = await prisma.examSession.create({
    data: {
      examId,
      studentId,
      status: "IN_PROGRESS",
      startTime: now,
      expiresAt: addSeconds(now, getDurationSeconds(exam.durationMinutes)),
      lastActivityAt: now,
      lastHeartbeatAt: now,
      attemptNumber: nextAttemptNumber,
      retakeMode: body.mode,
      parentSessionId: body.sourceSessionId ?? null,
      retakeQuestionIds,
    },
    select: {
      id: true,
      status: true,
      startTime: true,
      expiresAt: true,
      activeTimeSeconds: true,
      idleTimeSeconds: true,
    },
  });

  const expiresAt = session.expiresAt!;

  const filteredQuestions = isSubset
    ? exam.questions.filter((eq) => retakeQuestionSet.has(eq.questionId))
    : exam.questions;

  const questions = filteredQuestions.map((eq, index) => ({
    questionId: eq.questionId,
    order: index + 1,
    type: eq.question.type as "MCQ" | "ESSAY",
    questionText: eq.question.questionText,
    latexEnabled: eq.question.latexEnabled,
    options: eq.question.options as Array<{ key: string; text: string }> | null,
    imageRef: eq.question.imageRef,
    image: serializeImageSummary(eq.question.image),
    imageUrl: eq.question.imageUrl,
    imageUrls: eq.question.imageUrls,
    subjectName: eq.question.subject.name,
    topicName: eq.question.topic.name,
    passage: eq.question.passage
      ? {
          id: eq.question.passage.id,
          title: eq.question.passage.title,
          content: eq.question.passage.content,
          imageRef: eq.question.passage.imageRef,
          image: serializeImageSummary(eq.question.passage.image),
        }
      : null,
    existingAnswer: null,
  }));

  return {
    sessionId: session.id,
    examId: exam.id,
    examTitle: exam.title,
    durationMinutes: exam.durationMinutes,
    gradingType: normalizeExamGradingType(exam.gradingType),
    status: session.status as "IN_PROGRESS",
    startTime: session.startTime.toISOString(),
    expiresAt: expiresAt.toISOString(),
    serverNow: now.toISOString(),
    secondsRemaining: getSecondsRemaining(expiresAt, now),
    activeTimeSeconds: session.activeTimeSeconds,
    idleTimeSeconds: session.idleTimeSeconds,
    questions,
    answeredCount: 0,
  };
}

export async function getExamAttemptSummary(
  prisma: PrismaClient,
  examId: string,
  studentId: string
) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      questions: {
        orderBy: { order: "asc" },
        select: {
          questionId: true,
          question: {
            select: {
              id: true,
              type: true,
              questionText: true,
              correctAnswer: true,
              subjectId: true,
              subject: { select: { id: true, name: true } },
              topic: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!exam) throw createHttpError(404, "Exam not found");

  const sessions = await prisma.examSession.findMany({
    where: {
      examId,
      studentId,
      status: { in: ["SUBMITTED", "GRADED"] },
    },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      attemptNumber: true,
      retakeMode: true,
      finalScore: true,
      rankingLevel: true,
      totalTimeSeconds: true,
      activeTimeSeconds: true,
      idleTimeSeconds: true,
      status: true,
      startTime: true,
      endTime: true,
    },
  });

  function serializeAttempt(s: (typeof sessions)[number]) {
    return {
      sessionId: s.id,
      attemptNumber: s.attemptNumber,
      retakeMode: (s.retakeMode as "FULL" | "INCORRECT_ONLY" | "SUBJECT_ONLY") ?? null,
      finalScore: s.finalScore !== null && s.finalScore !== undefined ? Number(s.finalScore) : null,
      rankingLevel: s.rankingLevel as
        | "SUPERIOR"
        | "ABOVE_AVERAGE"
        | "HIGH_AVERAGE"
        | "AVERAGE"
        | "LOW_AVERAGE"
        | null,
      totalTimeSeconds: s.totalTimeSeconds,
      activeTimeSeconds: s.activeTimeSeconds,
      idleTimeSeconds: s.idleTimeSeconds,
      status: s.status as "SUBMITTED" | "GRADED",
      startTime: s.startTime.toISOString(),
      endTime: s.endTime?.toISOString() ?? null,
    };
  }

  const firstSession = sessions[0];
  const latestSession = sessions[sessions.length - 1];
  const firstAttempt = firstSession ? serializeAttempt(firstSession) : null;
  const latestAttempt = latestSession ? serializeAttempt(latestSession) : null;

  const gradedSessions = sessions.filter((s) => s.finalScore !== null);
  const bestScoreSession = gradedSessions.length > 0
    ? gradedSessions.reduce((best, s) =>
        Number(s.finalScore) > Number(best.finalScore) ? s : best
      )
    : null;
  const bestScore = bestScoreSession ? serializeAttempt(bestScoreSession) : null;

  // Get incorrect questions from the latest graded session
  const latestGraded = [...sessions].reverse().find((s) => s.status === "GRADED");
  let incorrectQuestions: Array<{
    questionId: string;
    questionText: string;
    type: "MCQ" | "ESSAY";
    subjectName: string;
    topicName: string;
    studentAnswer: string;
    correctAnswer: string;
  }> = [];

  if (latestGraded) {
    const answers = await prisma.studentAnswer.findMany({
      where: { sessionId: latestGraded.id, isCorrect: false },
      select: {
        questionId: true,
        studentAnswer: true,
      },
    });

    const questionMap = new Map(exam.questions.map((eq) => [eq.questionId, eq.question]));

    incorrectQuestions = answers
      .filter((a) => a.studentAnswer.trim() !== "")
      .map((a) => {
        const q = questionMap.get(a.questionId);
        if (!q) return null;
        return {
          questionId: a.questionId,
          questionText: q.questionText,
          type: q.type as "MCQ" | "ESSAY",
          subjectName: q.subject.name,
          topicName: q.topic.name,
          studentAnswer: a.studentAnswer,
          correctAnswer: q.correctAnswer,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  // Subject breakdown from the latest graded session
  let subjects: Array<{
    subjectId: string;
    subjectName: string;
    totalQuestions: number;
    correctCount: number;
  }> = [];

  if (latestGraded) {
    const allAnswers = await prisma.studentAnswer.findMany({
      where: { sessionId: latestGraded.id },
      select: { questionId: true, isCorrect: true, studentAnswer: true },
    });

    const subjectMap = new Map<string, { name: string; total: number; correct: number }>();
    const questionMap = new Map(exam.questions.map((eq) => [eq.questionId, eq.question]));

    for (const a of allAnswers) {
      const q = questionMap.get(a.questionId);
      if (!q) continue;
      const existing = subjectMap.get(q.subjectId) ?? { name: q.subject.name, total: 0, correct: 0 };
      subjectMap.set(q.subjectId, {
        name: existing.name,
        total: existing.total + 1,
        correct: existing.correct + (a.isCorrect ? 1 : 0),
      });
    }

    subjects = Array.from(subjectMap.entries()).map(([subjectId, data]) => ({
      subjectId,
      subjectName: data.name,
      totalQuestions: data.total,
      correctCount: data.correct,
    }));
  }

  return {
    examId: exam.id,
    examTitle: exam.title,
    totalAttempts: sessions.length,
    firstAttempt,
    latestAttempt,
    bestScore,
    incorrectQuestions,
    subjects,
  };
}

export async function upsertAnswer(
  prisma: PrismaClient,
  sessionId: string,
  studentId: string,
  body: SubmitAnswerBody
) {
  const now = new Date();
  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      status: true,
      examId: true,
      startTime: true,
      expiresAt: true,
      exam: { select: { durationMinutes: true } },
    },
  });
  if (!session) throw createHttpError(404, "Session not found");
  if (session.studentId !== studentId) throw createHttpError(403, "Forbidden");
  if (session.status !== "IN_PROGRESS") {
    throw createHttpError(409, "Exam session is no longer active");
  }
  if (session.exam.durationMinutes === null || session.exam.durationMinutes === undefined) {
    throw createHttpError(422, "Exam duration has not been set");
  }
  const expiresAt = await ensureSessionExpiresAt(prisma, session, session.exam.durationMinutes);
  assertSessionCanAcceptWork(expiresAt, now);

  await assertQuestionBelongsToExam(prisma, session.examId, body.questionId);

  const existing = await prisma.studentAnswer.findUnique({
    where: { sessionId_questionId: { sessionId, questionId: body.questionId } },
    select: { id: true, timeSpentSeconds: true },
  });
  const nextTimeSpentSeconds = getNextTimeSpentSeconds(
    existing?.timeSpentSeconds ?? 0,
    body.timeSpentSeconds,
    body.timeSpentDeltaSeconds
  );
  const timeSpentDeltaSeconds = clampDeltaSeconds(body.timeSpentDeltaSeconds);

  await prisma.studentAnswer.upsert({
    where: { sessionId_questionId: { sessionId, questionId: body.questionId } },
    update: {
      studentAnswer: body.studentAnswer,
      timeSpentSeconds: nextTimeSpentSeconds,
    },
    create: {
      sessionId,
      questionId: body.questionId,
      studentAnswer: body.studentAnswer,
      isCorrect: false,
      timeSpentSeconds: nextTimeSpentSeconds,
    },
  });

  await prisma.examSession.update({
    where: { id: sessionId },
    data: {
      activeQuestionId: body.questionId,
      lastActivityAt: now,
      lastHeartbeatAt: now,
      activeTimeSeconds: { increment: timeSpentDeltaSeconds },
    },
  });

  return {
    questionId: body.questionId,
    studentAnswer: body.studentAnswer,
    timeSpentSeconds: nextTimeSpentSeconds,
  };
}

export async function batchUpsertAnswers(
  prisma: PrismaClient,
  sessionId: string,
  studentId: string,
  body: BatchAnswersBody
) {
  const now = new Date();
  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      status: true,
      examId: true,
      startTime: true,
      expiresAt: true,
      exam: { select: { durationMinutes: true } },
    },
  });
  if (!session) throw createHttpError(404, "Session not found");
  if (session.studentId !== studentId) throw createHttpError(403, "Forbidden");
  if (session.status !== "IN_PROGRESS") {
    throw createHttpError(409, "Exam session is no longer active");
  }
  if (session.exam.durationMinutes === null || session.exam.durationMinutes === undefined) {
    throw createHttpError(422, "Exam duration has not been set");
  }
  const expiresAt = await ensureSessionExpiresAt(prisma, session, session.exam.durationMinutes);
  assertSessionCanAcceptWork(expiresAt, now);

  // Validate all questionIds belong to the exam in a single query
  const validQuestionIds = await prisma.examQuestion.findMany({
    where: {
      examId: session.examId,
      questionId: { in: body.answers.map((a) => a.questionId) },
    },
    select: { questionId: true },
  });
  const validSet = new Set(validQuestionIds.map((q) => q.questionId));
  const invalidIds = body.answers.filter((a) => !validSet.has(a.questionId));
  if (invalidIds.length > 0) {
    throw createHttpError(400, `Questions not in exam: ${invalidIds.map((a) => a.questionId).join(", ")}`);
  }

  // Batch upsert all answers in a single transaction
  await prisma.$transaction(async (tx) => {
    for (const answer of body.answers) {
      await tx.studentAnswer.upsert({
        where: { sessionId_questionId: { sessionId, questionId: answer.questionId } },
        update: {
          studentAnswer: answer.studentAnswer,
          timeSpentSeconds: answer.timeSpentSeconds,
        },
        create: {
          sessionId,
          questionId: answer.questionId,
          studentAnswer: answer.studentAnswer,
          isCorrect: false,
          timeSpentSeconds: answer.timeSpentSeconds,
        },
      });
    }

    await tx.examSession.update({
      where: { id: sessionId },
      data: {
        lastActivityAt: now,
        lastHeartbeatAt: now,
      },
    });
  });

  return { savedCount: body.answers.length };
}

export async function recordSessionHeartbeat(
  prisma: PrismaClient,
  sessionId: string,
  studentId: string,
  body: SessionHeartbeatBody
) {
  const now = new Date();
  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      status: true,
      examId: true,
      startTime: true,
      expiresAt: true,
      activeTimeSeconds: true,
      idleTimeSeconds: true,
      exam: { select: { durationMinutes: true } },
    },
  });

  if (!session) throw createHttpError(404, "Session not found");
  if (session.studentId !== studentId) throw createHttpError(403, "Forbidden");
  if (session.status !== "IN_PROGRESS") {
    throw createHttpError(409, "Exam session is no longer active");
  }
  if (session.exam.durationMinutes === null || session.exam.durationMinutes === undefined) {
    throw createHttpError(422, "Exam duration has not been set");
  }

  const expiresAt = await ensureSessionExpiresAt(prisma, session, session.exam.durationMinutes);
  const expired = isSessionExpired(expiresAt, now);
  const activeQuestionId = body.activeQuestionId ?? null;
  const activeTimeDeltaSeconds = expired ? 0 : clampDeltaSeconds(body.activeTimeDeltaSeconds);
  const idleTimeDeltaSeconds = expired ? 0 : clampDeltaSeconds(body.idleTimeDeltaSeconds);

  // Heartbeat only updates session-level time tracking.
  // Per-question time is written exclusively by batch sync / submit.
  await prisma.examSession.update({
    where: { id: sessionId },
    data: {
      activeQuestionId,
      lastHeartbeatAt: now,
      ...(activeTimeDeltaSeconds > 0 ? { lastActivityAt: now } : {}),
      activeTimeSeconds: { increment: activeTimeDeltaSeconds },
      idleTimeSeconds: { increment: idleTimeDeltaSeconds },
    },
  });

  return {
    sessionId,
    status: session.status as "IN_PROGRESS",
    serverNow: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    secondsRemaining: getSecondsRemaining(expiresAt, now),
    activeQuestionId,
    activeTimeSeconds: session.activeTimeSeconds + activeTimeDeltaSeconds,
    idleTimeSeconds: session.idleTimeSeconds + idleTimeDeltaSeconds,
    expired,
  };
}

export async function submitExamSession(
  prisma: PrismaClient,
  sessionId: string,
  studentId: string,
  body: SubmitSessionBody
) {
  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      status: true,
      examId: true,
      startTime: true,
      expiresAt: true,
      retakeQuestionIds: true,
      exam: { select: { durationMinutes: true } },
    },
  });
  if (!session) throw createHttpError(404, "Session not found");
  if (session.studentId !== studentId) throw createHttpError(403, "Forbidden");
  if (session.status !== "IN_PROGRESS") {
    throw createHttpError(409, "Exam session is already submitted");
  }
  if (session.exam.durationMinutes === null || session.exam.durationMinutes === undefined) {
    throw createHttpError(422, "Exam duration has not been set");
  }

  const endTime = new Date();
  const expiresAt = await ensureSessionExpiresAt(prisma, session, session.exam.durationMinutes);
  const totalTimeSeconds = getElapsedSessionSeconds(session.startTime, expiresAt, endTime);

  const examQuestionIds = await prisma.examQuestion.findMany({
    where: { examId: session.examId },
    select: { questionId: true },
  });
  const allExamQuestionIds = new Set(examQuestionIds.map((eq) => eq.questionId));

  // For retake sessions with a subset, only consider retake questions
  const isRetakeSubset = session.retakeQuestionIds.length > 0;
  const targetQuestionIds = isRetakeSubset
    ? new Set(session.retakeQuestionIds.filter((qid) => allExamQuestionIds.has(qid)))
    : allExamQuestionIds;

  await prisma.$transaction(async (tx) => {
    // Upsert any inline final answers sent with the submit call
    if (body.answers && body.answers.length > 0) {
      for (const answer of body.answers) {
        if (!targetQuestionIds.has(answer.questionId)) continue;
        await tx.studentAnswer.upsert({
          where: { sessionId_questionId: { sessionId, questionId: answer.questionId } },
          update: {
            studentAnswer: answer.studentAnswer,
            timeSpentSeconds: answer.timeSpentSeconds,
          },
          create: {
            sessionId,
            questionId: answer.questionId,
            studentAnswer: answer.studentAnswer,
            isCorrect: false,
            timeSpentSeconds: answer.timeSpentSeconds,
          },
        });
      }
    }

    // Fill empty answers for unanswered questions (only for target questions)
    const existingAnswers = await tx.studentAnswer.findMany({
      where: { sessionId },
      select: { questionId: true },
    });
    const existingAnswerIds = new Set(existingAnswers.map((a) => a.questionId));
    const missingQuestionIds = [...targetQuestionIds].filter((qid) => !existingAnswerIds.has(qid));

    if (missingQuestionIds.length > 0) {
      await tx.studentAnswer.createMany({
        data: missingQuestionIds.map((questionId) => ({
          sessionId,
          questionId,
          studentAnswer: "",
          isCorrect: false,
          timeSpentSeconds: 0,
        })),
      });
    }

    const { count } = await tx.examSession.updateMany({
      where: { id: sessionId, status: "IN_PROGRESS" },
      data: {
        status: "SUBMITTED",
        endTime,
        totalTimeSeconds,
      },
    });
    if (count === 0) {
      throw createHttpError(409, "Exam session is already submitted");
    }
  });

  return {
    sessionId,
    status: "SUBMITTED" as const,
    submittedAt: endTime.toISOString(),
    totalTimeSeconds,
    message: "Your exam has been submitted and is being graded.",
  };
}

export async function getSessionInsights(
  prisma: PrismaClient,
  sessionId: string,
  studentId: string
) {
  // Use getSessionResult to reuse all the existing formatting logic
  const result = await getSessionResult(prisma, sessionId, studentId);
  
  if (result.status !== "GRADED" && result.status !== "SUBMITTED") {
    throw createHttpError(400, "Insights are only available for submitted exams.");
  }

  // Find the subject and topic details for the questions
  const questions = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      exam: {
        select: {
          questions: {
            select: {
              questionId: true,
              question: {
                select: {
                  difficulty: true,
                  subject: { select: { name: true } },
                  topic: { select: { name: true } },
                }
              }
            }
          }
        }
      }
    }
  });

  if (!questions) throw createHttpError(404, "Session data not found");
  
  const questionMap = new Map(questions.exam.questions.map(q => [q.questionId, q.question]));

  const aiInput = {
    examTitle: result.examTitle,
    totalQuestions: result.totalQuestions,
    correctCount: result.correctCount,
    totalTimeSeconds: result.totalTimeSeconds ?? 0,
    answers: result.answers.map(a => {
      const qMeta = questionMap.get(a.questionId);
      return {
        questionId: a.questionId,
        isCorrect: a.isCorrect,
        timeSpentSeconds: a.timeSpentSeconds,
        difficulty: qMeta?.difficulty as "EASY" | "MEDIUM" | "HARD" ?? "MEDIUM",
        subjectName: qMeta?.subject.name ?? "Unknown",
        topicName: qMeta?.topic.name ?? "Unknown",
      };
    })
  };

  const insights = await generateSessionInsightsWithAi(aiInput);
  if (!insights) {
    throw createHttpError(500, "Failed to generate AI insights.");
  }

  return insights;
}

export async function listExamSubmissions(
  prisma: PrismaClient,
  examId: string,
  query: ExamSubmissionsQuery
) {
  const { page, limit, status } = query;
  const skip = (page - 1) * limit;

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: EXAM_SELECT,
  });

  if (!exam) throw createHttpError(404, "Exam not found");

  const where: Prisma.ExamSessionWhereInput = {
    examId,
    ...(status === "PENDING_REVIEW"
      ? { status: "SUBMITTED" as const }
      : status === "GRADED"
        ? { status: "GRADED" as const }
        : { status: { in: ["SUBMITTED", "GRADED"] } }),
  };

  const [sessions, total] = await Promise.all([
    prisma.examSession.findMany({
      where,
      orderBy: { endTime: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        studentId: true,
        status: true,
        finalScore: true,
        rankingLevel: true,
        endTime: true,
        totalTimeSeconds: true,
        activeTimeSeconds: true,
        idleTimeSeconds: true,
        student: {
          select: {
            fullName: true,
            email: true,
            emailEncrypted: true,
          },
        },
        answers: {
          select: {
            studentAnswer: true,
            manualScore: true,
            aiFeedback: true,
            question: {
              select: {
                type: true,
              },
            },
          },
        },
      },
    }),
    prisma.examSession.count({ where }),
  ]);

  const submissions = sessions.map((session) => {
    const answered = session.answers.filter((answer) => answer.studentAnswer.trim()).length;
    const essayAnswers = session.answers.filter(
      (answer) => answer.question.type === "ESSAY" && answer.studentAnswer.trim()
    );
    const pendingReviewCount = essayAnswers.filter((answer) => {
      const reviewStatus = getAnswerReviewStatus({
        type: answer.question.type as "MCQ" | "ESSAY",
        gradingType: normalizeExamGradingType(exam.gradingType),
        studentAnswer: answer.studentAnswer,
        manualScore: answer.manualScore !== null && answer.manualScore !== undefined ? Number(answer.manualScore) : null,
        aiFeedback: serializeAiFeedback(answer.aiFeedback ?? null),
      });

      return reviewStatus === "PENDING_REVIEW";
    }).length;

    return {
      sessionId: session.id,
      studentId: session.studentId,
      studentName: decryptField(session.student.fullName),
      studentEmail: decryptField(session.student.emailEncrypted),
      status: session.status as "SUBMITTED" | "GRADED",
      finalScore: session.finalScore !== null && session.finalScore !== undefined ? Number(session.finalScore) : null,
      rankingLevel: session.rankingLevel as
        | "SUPERIOR"
        | "ABOVE_AVERAGE"
        | "HIGH_AVERAGE"
        | "AVERAGE"
        | "LOW_AVERAGE"
        | null,
      submittedAt: session.endTime?.toISOString() ?? null,
      gradedAt: session.status === "GRADED" ? session.endTime?.toISOString() ?? null : null,
      totalAnswers: answered,
      totalEssayAnswers: essayAnswers.length,
      pendingReviewCount,
      reviewedEssayCount: Math.max(0, essayAnswers.length - pendingReviewCount),
      totalTimeSeconds: session.totalTimeSeconds ?? null,
      activeTimeSeconds: session.activeTimeSeconds,
      idleTimeSeconds: session.idleTimeSeconds,
    };
  });

  return {
    data: {
      exam: serializeExam(exam),
      submissions,
    },
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getReviewSession(
  prisma: PrismaClient,
  sessionId: string
) {
  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      examId: true,
      status: true,
      finalScore: true,
      rankingLevel: true,
      totalTimeSeconds: true,
      activeTimeSeconds: true,
      idleTimeSeconds: true,
      startTime: true,
      endTime: true,
      student: {
        select: {
          id: true,
          fullName: true,
          email: true,
          emailEncrypted: true,
        },
      },
      exam: {
        select: {
          title: true,
          gradingType: true,
          questions: {
            orderBy: { order: "asc" },
            select: {
              order: true,
              questionId: true,
              question: {
                select: {
                  id: true,
                  type: true,
                  questionText: true,
                  latexEnabled: true,
                  options: true,
                  correctAnswer: true,
                  explanation: true,
                  maxMarks: true,
                },
              },
            },
          },
        },
      },
      answers: {
        select: {
          id: true,
          questionId: true,
          studentAnswer: true,
          isCorrect: true,
          timeSpentSeconds: true,
          awardedMarks: true,
          manualScore: true,
          tutorFeedback: true,
          aiFeedback: true,
        },
      },
    },
  });

  if (!session) throw createHttpError(404, "Session not found");

  const answerMap = new Map(session.answers.map((answer) => [answer.questionId, answer]));

  return {
    sessionId: session.id,
    examId: session.examId,
    examTitle: session.exam.title,
    gradingType: normalizeExamGradingType(session.exam.gradingType),
    status: session.status as "SUBMITTED" | "GRADED",
    student: {
      id: session.student.id,
      fullName: decryptField(session.student.fullName),
      email: decryptField(session.student.emailEncrypted),
    },
    finalScore: session.finalScore !== null && session.finalScore !== undefined ? Number(session.finalScore) : null,
    rankingLevel: session.rankingLevel as
      | "SUPERIOR"
      | "ABOVE_AVERAGE"
      | "HIGH_AVERAGE"
      | "AVERAGE"
      | "LOW_AVERAGE"
      | null,
    totalTimeSeconds: session.totalTimeSeconds,
    activeTimeSeconds: session.activeTimeSeconds,
    idleTimeSeconds: session.idleTimeSeconds,
    startTime: session.startTime.toISOString(),
    endTime: session.endTime?.toISOString() ?? null,
    answers: session.exam.questions.map((eq) => {
      const answer = answerMap.get(eq.questionId);
      const manualScore = answer?.manualScore !== null && answer?.manualScore !== undefined ? Number(answer.manualScore) : null;
      const studentAnswer = answer?.studentAnswer ?? "";
      const aiFeedback = serializeAiFeedback(answer?.aiFeedback ?? null);

      return {
        answerId: answer?.id ?? null,
        questionId: eq.questionId,
        order: eq.order,
        type: eq.question.type as "MCQ" | "ESSAY",
        questionText: eq.question.questionText,
        latexEnabled: eq.question.latexEnabled,
        options: eq.question.options as Array<{ key: string; text: string }> | null,
        correctAnswer: eq.question.correctAnswer,
        explanation: eq.question.explanation ?? null,
        maxMarks: normalizeQuestionMaxMarks(eq.question.maxMarks),
        studentAnswer,
        timeSpentSeconds: answer?.timeSpentSeconds ?? 0,
        isCorrect: answer?.isCorrect ?? false,
        awardedMarks: answer?.awardedMarks !== null && answer?.awardedMarks !== undefined ? Number(answer.awardedMarks) : null,
        manualScore,
        tutorFeedback: answer?.tutorFeedback ?? null,
        reviewStatus: getAnswerReviewStatus({
          type: eq.question.type as "MCQ" | "ESSAY",
          gradingType: normalizeExamGradingType(session.exam.gradingType),
          studentAnswer,
          manualScore,
          aiFeedback,
        }),
        aiFeedback,
      };
    }),
  };
}

export async function submitManualGrades(
  prisma: PrismaClient,
  sessionId: string,
  body: SubmitManualGradesBody
) {
  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      status: true,
      exam: {
        select: {
          gradingType: true,
          questions: {
            select: {
              questionId: true,
              question: {
                select: {
                  id: true,
                  type: true,
                  correctAnswer: true,
                  maxMarks: true,
                  subjectId: true,
                  topicId: true,
                },
              },
            },
          },
        },
      },
      answers: {
        select: {
          id: true,
          questionId: true,
          studentAnswer: true,
          isCorrect: true,
          awardedMarks: true,
          manualScore: true,
          aiFeedback: true,
        },
      },
    },
  });

  if (!session) throw createHttpError(404, "Session not found");
  if (session.status === "IN_PROGRESS") {
    throw createHttpError(409, "Session is still in progress");
  }

  const essayQuestions = session.exam.questions.filter((eq) => eq.question.type === "ESSAY");
  const essayQuestionIds = new Set(essayQuestions.map((eq) => eq.questionId));
  const questionMaxMarksById = new Map(
    essayQuestions.map((eq) => [eq.questionId, normalizeQuestionMaxMarks(eq.question.maxMarks)])
  );

  const answerByQuestionId = new Map(
    session.answers.map((a) => [a.questionId, a])
  );

  for (const grade of body.grades) {
    if (!essayQuestionIds.has(grade.questionId)) {
      throw createHttpError(422, "Manual grades can only be submitted for essay questions");
    }
    const maxMarks = questionMaxMarksById.get(grade.questionId) ?? 1;
    if (grade.manualScore > maxMarks) {
      throw createHttpError(422, `Manual score for question ${grade.questionId} cannot exceed max marks (${maxMarks})`);
    }

    // When overriding an AI-graded answer, tutor feedback is mandatory
    const existingAnswer = answerByQuestionId.get(grade.questionId);
    if (existingAnswer?.aiFeedback) {
      const serialized = serializeAiFeedback(existingAnswer.aiFeedback);
      if (serialized && !serialized.pendingReview) {
        if (!grade.tutorFeedback || !grade.tutorFeedback.trim()) {
          throw createHttpError(422, "Tutor feedback is required when overriding an AI-graded answer");
        }
      }
    }
  }

  const sessionAnswerMap = new Map(
    session.answers.map((answer) => [
      answer.questionId,
      {
        id: answer.id,
        studentAnswer: answer.studentAnswer,
        isCorrect: answer.isCorrect,
        manualScore: answer.manualScore !== null && answer.manualScore !== undefined ? Number(answer.manualScore) : null,
        awardedMarks: answer.awardedMarks !== null && answer.awardedMarks !== undefined ? Number(answer.awardedMarks) : null,
        aiFeedback: answer.aiFeedback,
      },
    ])
  );

  const outcome = await prisma.$transaction(async (tx) => {
    for (const grade of body.grades) {
      const existingAnswer = sessionAnswerMap.get(grade.questionId);
      const manualScore = grade.manualScore;
      const maxMarks = questionMaxMarksById.get(grade.questionId) ?? 1;
      const awardedMarks = Math.min(maxMarks, Math.max(0, manualScore));
      const isCorrect = isAwardedMarksCorrect(awardedMarks, maxMarks);
      const tutorFeedback = normalizeTutorFeedback(grade.tutorFeedback);

      if (existingAnswer) {
        await tx.studentAnswer.update({
          where: { id: existingAnswer.id },
          data: {
            manualScore,
            awardedMarks,
            tutorFeedback,
            isCorrect,
          },
        });
      } else {
        const created = await tx.studentAnswer.create({
          data: {
            sessionId,
            questionId: grade.questionId,
            studentAnswer: "",
            timeSpentSeconds: 0,
            manualScore,
            awardedMarks,
            tutorFeedback,
            isCorrect,
          },
          select: {
            id: true,
          },
        });

        sessionAnswerMap.set(grade.questionId, {
          id: created.id,
          studentAnswer: "",
          isCorrect,
          manualScore,
          awardedMarks,
          aiFeedback: null,
        });
      }

      const current = sessionAnswerMap.get(grade.questionId);
      if (current) {
        sessionAnswerMap.set(grade.questionId, {
          ...current,
          manualScore,
          isCorrect,
          awardedMarks,
        });
      }
    }

    const nextOutcome = evaluateSessionOutcome({
      gradingType: normalizeExamGradingType(session.exam.gradingType),
      examQuestions: session.exam.questions.map((eq) => ({
        questionId: eq.questionId,
        question: {
          id: eq.question.id,
          type: eq.question.type as "MCQ" | "ESSAY",
          correctAnswer: eq.question.correctAnswer,
          maxMarks: eq.question.maxMarks,
        },
      })),
      answerMap: new Map(
        Array.from(sessionAnswerMap.entries()).map(([questionId, answer]) => [
          questionId,
          {
            studentAnswer: answer.studentAnswer,
            isCorrect: answer.isCorrect,
            manualScore: answer.manualScore,
            awardedMarks: answer.awardedMarks,
            aiFeedback: answer.aiFeedback,
          },
        ])
      ),
    });

    await tx.examSession.update({
      where: { id: sessionId },
      data: {
        status: nextOutcome.status,
        finalScore: nextOutcome.finalScore,
        rankingLevel: nextOutcome.rankingLevel,
      },
    });
    return nextOutcome;
  });

  if (outcome.status === "GRADED" && outcome.finalScore !== null) {
    const topicScores = new Map<string, { subjectId: string; correct: number; total: number }>();

    for (const eq of session.exam.questions) {
      const topicId = eq.question.topicId;
      const subjectId = eq.question.subjectId;
      const sa = sessionAnswerMap.get(eq.questionId);
      if (!sa) continue;

      const existing = topicScores.get(topicId) ?? { subjectId, correct: 0, total: 0 };
      topicScores.set(topicId, {
        subjectId,
        correct: existing.correct + (sa.isCorrect ? 1 : 0),
        total: existing.total + 1,
      });
    }

    for (const [topicId, { subjectId, correct, total }] of topicScores.entries()) {
      const topicScore = total > 0 ? (correct / total) * 100 : 0;

      const perf = await prisma.studentPerformance.findUnique({
        where: { studentId_topicId: { studentId: session.studentId, topicId } },
        select: { scoreAvg: true, attemptCount: true },
      });

      if (perf) {
        const newAvg = (perf.scoreAvg * perf.attemptCount + topicScore) / (perf.attemptCount + 1);
        await prisma.studentPerformance.update({
          where: { studentId_topicId: { studentId: session.studentId, topicId } },
          data: { scoreAvg: newAvg, attemptCount: { increment: 1 } },
        });
      } else {
        await prisma.studentPerformance.create({
          data: {
            studentId: session.studentId,
            subjectId,
            topicId,
            scoreAvg: topicScore,
            attemptCount: 1,
          },
        });
      }
    }
  }

  const refreshedSession = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      status: true,
      finalScore: true,
      rankingLevel: true,
      answers: {
        select: {
          studentAnswer: true,
          manualScore: true,
          aiFeedback: true,
          question: {
            select: {
              type: true,
            },
          },
        },
      },
      exam: {
        select: {
          id: true,
          title: true,
          gradingType: true,
        },
      },
    },
  });

  if (!refreshedSession) throw createHttpError(404, "Session not found after grading");

  const pendingReviewCount = refreshedSession.answers.filter((answer) => {
    const reviewStatus = getAnswerReviewStatus({
      type: answer.question.type as "MCQ" | "ESSAY",
      gradingType: normalizeExamGradingType(refreshedSession.exam.gradingType),
      studentAnswer: answer.studentAnswer,
      manualScore: answer.manualScore !== null && answer.manualScore !== undefined ? Number(answer.manualScore) : null,
      aiFeedback: serializeAiFeedback(answer.aiFeedback ?? null),
    });

    return reviewStatus === "PENDING_REVIEW";
  }).length;

  if (session.status !== "GRADED" && refreshedSession.status === "GRADED") {
    void createNotification(prisma, {
      userId: refreshedSession.studentId,
      type: "EXAM_MANUAL_GRADING_COMPLETED",
      title: "Exam Review Completed",
      message: `Your results for \"${refreshedSession.exam.title}\" are now available.`,
      data: {
        examId: refreshedSession.exam.id,
        sessionId: refreshedSession.id,
        status: refreshedSession.status,
        url: `/dashboard/exams/sessions/${refreshedSession.id}/result`,
      },
    }).catch(() => undefined);
  }

  return {
    sessionId: refreshedSession.id,
    status: refreshedSession.status as "SUBMITTED" | "GRADED",
    finalScore:
      refreshedSession.finalScore !== null && refreshedSession.finalScore !== undefined
        ? Number(refreshedSession.finalScore)
        : null,
    rankingLevel: refreshedSession.rankingLevel as
      | "SUPERIOR"
      | "ABOVE_AVERAGE"
      | "HIGH_AVERAGE"
      | "AVERAGE"
      | "LOW_AVERAGE"
      | null,
    pendingReviewCount,
  };
}

export async function getSessionResult(
  prisma: PrismaClient,
  sessionId: string,
  studentId: string
) {
  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      examId: true,
      studentId: true,
      status: true,
      finalScore: true,
      rankingLevel: true,
      totalTimeSeconds: true,
      activeTimeSeconds: true,
      idleTimeSeconds: true,
      startTime: true,
      endTime: true,
      exam: {
        select: {
          title: true,
          gradingType: true,
          questions: {
            orderBy: { order: "asc" },
            select: {
              order: true,
              questionId: true,
              question: {
                select: {
                  id: true,
                  type: true,
                  questionText: true,
                  latexEnabled: true,
                  options: true,
                  correctAnswer: true,
                  explanation: true,
                  maxMarks: true,
                },
              },
            },
          },
        },
      },
      answers: {
        select: {
          questionId: true,
          studentAnswer: true,
          isCorrect: true,
          timeSpentSeconds: true,
          awardedMarks: true,
          manualScore: true,
          tutorFeedback: true,
          aiFeedback: true,
        },
      },
    },
  });

  if (!session) throw createHttpError(404, "Session not found");
  if (session.studentId !== studentId) throw createHttpError(403, "Forbidden");
  if (session.status === "IN_PROGRESS") {
    throw createHttpError(400, "Exam session is still in progress");
  }

  const answerMap = new Map(session.answers.map((a) => [a.questionId, a]));

  const answers = session.exam.questions.map((eq) => {
    const answer = answerMap.get(eq.questionId);
    const studentAnswer = answer?.studentAnswer ?? "";
    const manualScore = answer?.manualScore !== null && answer?.manualScore !== undefined ? Number(answer.manualScore) : null;
    const aiFeedback = serializeAiFeedback(answer?.aiFeedback ?? null);
    const reviewStatus = getAnswerReviewStatus({
      type: eq.question.type as "MCQ" | "ESSAY",
      gradingType: normalizeExamGradingType(session.exam.gradingType),
      studentAnswer,
      manualScore,
      aiFeedback,
    });
    
    const isPending = reviewStatus === "PENDING_REVIEW";

    return {
      questionId: eq.questionId,
      order: eq.order,
      questionText: eq.question.questionText,
      latexEnabled: eq.question.latexEnabled,
      type: eq.question.type as "MCQ" | "ESSAY",
      options: eq.question.options as Array<{ key: string; text: string }> | null,
      studentAnswer,
      correctAnswer: isPending ? "" : eq.question.correctAnswer,
      explanation: isPending ? null : (eq.question.explanation ?? null),
      maxMarks: normalizeQuestionMaxMarks(eq.question.maxMarks),
      isCorrect: isPending ? false : (answer?.isCorrect ?? false),
      timeSpentSeconds: answer?.timeSpentSeconds ?? 0,
      awardedMarks: answer?.awardedMarks !== null && answer?.awardedMarks !== undefined ? Number(answer.awardedMarks) : null,
      manualScore,
      tutorFeedback: answer?.tutorFeedback ?? null,
      reviewStatus,
      aiFeedback,
    };
  });

  return {
    sessionId: session.id,
    examId: session.examId,
    examTitle: session.exam.title,
    status: session.status as "SUBMITTED" | "GRADED",
    finalScore: session.finalScore !== null && session.finalScore !== undefined ? Number(session.finalScore) : null,
    rankingLevel: session.rankingLevel as
      | "SUPERIOR"
      | "ABOVE_AVERAGE"
      | "HIGH_AVERAGE"
      | "AVERAGE"
      | "LOW_AVERAGE"
      | null,
    totalTimeSeconds: session.totalTimeSeconds,
    activeTimeSeconds: session.activeTimeSeconds,
    idleTimeSeconds: session.idleTimeSeconds,
    totalQuestions: session.exam.questions.length,
    correctCount: answers.filter(a => a.isCorrect).length,
    gradingType: normalizeExamGradingType(session.exam.gradingType),
    startTime: session.startTime.toISOString(),
    endTime: session.endTime?.toISOString() ?? null,
    answers,
  };
}

export async function listStudentSessions(
  prisma: PrismaClient,
  studentId: string,
  query: ListSessionsQuery
) {
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.examSession.findMany({
      where: { studentId },
      skip,
      take: limit,
      orderBy: { startTime: "desc" },
      select: {
        id: true,
        examId: true,
        status: true,
        finalScore: true,
        rankingLevel: true,
        totalTimeSeconds: true,
        activeTimeSeconds: true,
        idleTimeSeconds: true,
        startTime: true,
        endTime: true,
        attemptNumber: true,
        retakeMode: true,
        exam: {
          select: {
            title: true,
            examType: true,
            durationMinutes: true,
          },
        },
      },
    }),
    prisma.examSession.count({ where: { studentId } }),
  ]);

  const data = items.map((s) => ({
    sessionId: s.id,
    examId: s.examId,
    examTitle: s.exam.title,
    examType: s.exam.examType as "MOCK_EXAM" | "ASSIGNMENT",
    durationMinutes: s.exam.durationMinutes,
    status: s.status as "IN_PROGRESS" | "SUBMITTED" | "GRADED",
    finalScore: s.finalScore !== null && s.finalScore !== undefined ? Number(s.finalScore) : null,
    rankingLevel: s.rankingLevel as
      | "SUPERIOR"
      | "ABOVE_AVERAGE"
      | "HIGH_AVERAGE"
      | "AVERAGE"
      | "LOW_AVERAGE"
      | null,
    totalTimeSeconds: s.totalTimeSeconds,
    activeTimeSeconds: s.activeTimeSeconds,
    idleTimeSeconds: s.idleTimeSeconds,
    startTime: s.startTime.toISOString(),
    endTime: s.endTime?.toISOString() ?? null,
    attemptNumber: s.attemptNumber,
    retakeMode: (s.retakeMode as "FULL" | "INCORRECT_ONLY" | "SUBJECT_ONLY") ?? null,
  }));

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
