import { Worker } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { Prisma, PrismaClient } from "@prisma/client";
import { buildEssayAiFeedback, gradeEssayWithAi, type AiRubricInput } from "../../utils/ai-grader.js";
import { resolveImagesAsBase64 } from "../images/images.service.js";
import { createNotification } from "../../lib/notify.js";
import { generateFromMistakes } from "../flashcards/flashcards.service.js";
import { getExamAttemptSummary } from "./exams.service.js";

export interface GradingJobData {
  sessionId: string;
}

const AI_RUBRIC_FOR_AI_SELECT = {
  id: true,
  name: true,
  totalMaxScore: true,
  bandDescriptors: {
    orderBy: [{ scoreMin: "asc" }, { scoreMax: "asc" }],
    select: {
      bandLabel: true,
      scoreMin: true,
      scoreMax: true,
      descriptor: true,
    },
  },
  calibrationNotes: {
    orderBy: { sortOrder: "asc" },
    select: {
      category: true,
      instruction: true,
    },
  },
  criteria: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      criterionName: true,
      criterionDescription: true,
      maxScore: true,
      highScoringIndicators: true,
      lowScoringIndicators: true,
      aiCalibrationNotes: true,
    },
  },
} satisfies Prisma.AiRubricSelect;

function toAiRubricInput(aiRubric: {
  id: string;
  name: string;
  totalMaxScore: number;
  bandDescriptors: Array<{
    bandLabel: string;
    scoreMin: number;
    scoreMax: number;
    descriptor: string;
  }>;
  calibrationNotes: Array<{
    category: string | null;
    instruction: string;
  }>;
  criteria: Array<{
    id: string;
    criterionName: string;
    criterionDescription: string;
    maxScore: number;
    highScoringIndicators: string[];
    lowScoringIndicators: string[];
    aiCalibrationNotes: string[];
  }>;
} | null): AiRubricInput | null {
  if (!aiRubric || aiRubric.criteria.length === 0) return null;
  return aiRubric;
}

interface RankingThresholds {
  thresholdSuperior: number;
  thresholdAboveAverage: number;
  thresholdHighAverage: number;
  thresholdAverage: number;
}

const DEFAULT_THRESHOLDS: RankingThresholds = {
  thresholdSuperior: 72,
  thresholdAboveAverage: 60,
  thresholdHighAverage: 50,
  thresholdAverage: 40,
};

function calculateRankingLevel(
  score: number,
  t: RankingThresholds = DEFAULT_THRESHOLDS
): "SUPERIOR" | "ABOVE_AVERAGE" | "HIGH_AVERAGE" | "AVERAGE" | "LOW_AVERAGE" {
  if (score >= t.thresholdSuperior) return "SUPERIOR";
  if (score >= t.thresholdAboveAverage) return "ABOVE_AVERAGE";
  if (score >= t.thresholdHighAverage) return "HIGH_AVERAGE";
  if (score >= t.thresholdAverage) return "AVERAGE";
  return "LOW_AVERAGE";
}

function normalizeQuestionMaxMarks(maxMarks: number) {
  return Number.isFinite(maxMarks) && maxMarks > 0 ? maxMarks : 1;
}

async function gradeSession(prisma: PrismaClient, sessionId: string, logger: FastifyBaseLogger) {
  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      status: true,
      retakeQuestionIds: true,
      exam: {
        select: {
          id: true,
          title: true,
          createdBy: true,
          gradingType: true,
          thresholdSuperior: true,
          thresholdAboveAverage: true,
          thresholdHighAverage: true,
          thresholdAverage: true,
          questions: {
            select: {
              questionId: true,
              question: {
                select: {
                  id: true,
                  type: true,
                  questionText: true,
                  writingType: true,
                  promptText: true,
                  markingGuide: true,
                  imageRefs: true,
                  markingType: true,
                  correctAnswer: true,
                  maxMarks: true,
                  subjectId: true,
                  topicId: true,
                  aiRubric: {
                    select: AI_RUBRIC_FOR_AI_SELECT,
                  },
                  subject: { select: { id: true } },
                  topic: { select: { id: true } },
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
        },
      },
    },
  });

  if (!session) {
    logger.warn({ sessionId }, "Session not found for grading");
    return;
  }

  if (session.status === "GRADED") {
    logger.warn({ sessionId }, "Session already graded, skipping");
    return;
  }

  if (session.status !== "SUBMITTED") {
    logger.warn({ sessionId, status: session.status }, "Session not in SUBMITTED state, skipping");
    return;
  }

  const answerMap = new Map(session.answers.map((a) => [a.questionId, a]));

  // For retake sessions, only grade the retake subset of questions
  const retakeSet = session.retakeQuestionIds.length > 0
    ? new Set(session.retakeQuestionIds)
    : null;
  const examQuestions = retakeSet
    ? session.exam.questions.filter((eq) => retakeSet.has(eq.questionId))
    : session.exam.questions;
  const totalQuestions = examQuestions.length;
  const gradingType = session.exam.gradingType === "MANUAL" ? "MANUAL" : "AUTO";

  if (totalQuestions === 0) {
    logger.warn({ sessionId }, "Exam has no questions, marking as graded with 0 score");
    await prisma.examSession.update({
      where: { id: sessionId },
      data: { status: "GRADED", finalScore: 0, rankingLevel: "LOW_AVERAGE" },
    });
    return;
  }

  // ── Grade MCQ answers (exact match) ──────────────────────────────────────
  const mcqUpdates: Array<{ id: string; isCorrect: boolean; awardedMarks: number }> = [];
  let correctCount = 0;
  let mcqAwardedMarks = 0;
  let mcqPossibleMarks = 0;
  let essayAwardedMarks = 0;
  let essayPossibleMarks = 0;

  for (const eq of examQuestions) {
    const question = eq.question;
    if (question.type !== "MCQ") continue;

    const maxMarks = normalizeQuestionMaxMarks(question.maxMarks);
    mcqPossibleMarks += maxMarks;
    const answer = answerMap.get(question.id);
    if (!answer) continue;

    const isCorrect =
      answer.studentAnswer.trim().toUpperCase() ===
      (question.correctAnswer ?? "").trim().toUpperCase();
    const awardedMarks = isCorrect ? maxMarks : 0;

    if (isCorrect) correctCount++;
    mcqAwardedMarks += awardedMarks;
    mcqUpdates.push({ id: answer.id, isCorrect, awardedMarks });
  }

  // ── Grade ESSAY answers via AI (AUTO grading only) ────────────────────────
  const essayUpdates: Array<{
    id: string;
    isCorrect: boolean;
    pendingReview: boolean;
    aiFeedback: object | null;
    scorePercent: number;
    awardedMarks: number;
    maxMarks: number;
    bandLabel: string | null;
    bandDescriptor: string | null;
    aiModel: string | null;
    criterionScores: Array<{
      criterionId: string;
      criterionName: string;
      score: number;
      maxScore: number;
      feedback: string;
      strengths: string[];
      improvements: string[];
      aiRubricId: string | null;
    }>;
  }> = [];
  let pendingReviewCount = 0;

  if (gradingType === "MANUAL") {
    const manualEssayAnswers = examQuestions
      .filter((eq) => eq.question.type === "ESSAY")
      .map((eq) => answerMap.get(eq.question.id))
      .filter((answer): answer is NonNullable<typeof answer> => Boolean(answer));

    pendingReviewCount = manualEssayAnswers.filter((answer) => answer.studentAnswer.trim()).length;
  }

  if (gradingType === "AUTO") {
    const essayQuestions = examQuestions.filter((eq) => eq.question.type === "ESSAY");

    // Grade all essays in parallel
    const essayResults = await Promise.all(
      essayQuestions.map(async (eq) => {
        const question = eq.question;
        const answer = answerMap.get(question.id);
        const maxMarks = normalizeQuestionMaxMarks(question.maxMarks);

        if (!answer || !answer.studentAnswer.trim()) {
          return {
            id: answer?.id ?? null,
            isCorrect: false,
            pendingReview: false,
            aiFeedback: null,
            scorePercent: 0,
            awardedMarks: 0,
            maxMarks,
            bandLabel: null,
            bandDescriptor: null,
            aiModel: null,
            criterionScores: [],
          };
        }

        // MANUAL marking: skip AI grading, leave for tutor review
        if (question.markingType === "MANUAL") {
          return {
            id: answer.id,
            isCorrect: false,
            pendingReview: true,
            aiFeedback: null,
            scorePercent: 0,
            awardedMarks: 0,
            maxMarks,
            bandLabel: null,
            bandDescriptor: null,
            aiModel: null,
            criterionScores: [],
          };
        }

        const aiRubric = toAiRubricInput(question.aiRubric);
        if (!aiRubric || question.markingType !== "AI") {
          throw new Error(`Essay question ${question.id} requires markingType AI and an active aiRubric`);
        }
        // Resolve any prompt images to base64 before calling AI
        const images = question.imageRefs && question.imageRefs.length > 0
          ? await resolveImagesAsBase64(prisma, question.imageRefs)
          : [];
        const aiResult = await gradeEssayWithAi({
          writingType: question.writingType,
          questionText: question.questionText,
          promptText: question.promptText,
          images: images.map(({ data, mediaType }) => ({ data, mediaType })),
          markingGuide: question.markingGuide,
          studentAnswer: answer.studentAnswer,
          aiRubric,
        });

        {
          // Per final-design Step 6:
          //   final_score = Σ ai_score_per_criterion  → simpan sebagai awardedMarks (raw sum)
          //   weighted_total = (Σ / totalMaxScore) × 100  → untuk band lookup
          const awardedMarks = aiResult.totalAwardedMarks;
          const scorePercent = aiResult.scorePercent;
          const criterionScores = aiResult.criterionScores?.map((score) => ({
            ...score,
            aiRubricId: aiResult.aiRubric.id,
          })) ?? [];
          logger.info(
            { sessionId, questionId: question.id, confidence: aiResult.confidence, aiRubricId: aiRubric?.id, scorePercent, awardedMarks, maxMarks },
            "AI graded essay answer"
          );
          return {
            id: answer.id,
            isCorrect: false,
            pendingReview: false,
            aiFeedback: buildEssayAiFeedback(aiResult),
            scorePercent,
            awardedMarks,
            maxMarks,
            bandLabel: aiResult.bandLabel,
            bandDescriptor: aiResult.bandDescriptor,
            aiModel: aiResult.aiModel,
            criterionScores,
          };
        }

        // AI unavailable — mark as pending review, do NOT count in score
      })
    );

    for (const result of essayResults) {
      if (result.pendingReview) {
        pendingReviewCount++;
      }
      if (!result.pendingReview) {
        essayAwardedMarks += result.awardedMarks;
        essayPossibleMarks += result.maxMarks;
      }
      if (result.id) {
        essayUpdates.push({
          id: result.id,
          isCorrect: result.isCorrect,
          pendingReview: result.pendingReview,
          aiFeedback: result.aiFeedback,
          scorePercent: result.scorePercent,
          awardedMarks: result.awardedMarks,
          maxMarks: result.maxMarks,
          bandLabel: result.bandLabel,
          bandDescriptor: result.bandDescriptor,
          aiModel: result.aiModel,
          criterionScores: result.criterionScores,
        });
      }
    }
  }

  // ── Calculate scores: MCQ, Essay, and Combined ───────────────────────────
  // mcqScore / essayScore tetap dihitung walaupun ada pending review, supaya
  // student bisa lihat partial breakdown sebelum tutor selesai grade essay.
  // finalScore (combined) hanya di-set ketika semua selesai (untuk ranking).
  let mcqScore: number | null = null;
  let essayScore: number | null = null;
  let finalScore: number | null = null;
  let rankingLevel: ReturnType<typeof calculateRankingLevel> | null = null;
  const sessionStatus: "SUBMITTED" | "GRADED" = pendingReviewCount > 0 ? "SUBMITTED" : "GRADED";

  if (mcqPossibleMarks > 0) {
    mcqScore = (mcqAwardedMarks / mcqPossibleMarks) * 100;
  }
  if (essayPossibleMarks > 0) {
    essayScore = (essayAwardedMarks / essayPossibleMarks) * 100;
  }

  if (gradingType === "AUTO" && pendingReviewCount === 0) {
    const totalAwarded = mcqAwardedMarks + essayAwardedMarks;
    const totalPossible = mcqPossibleMarks + essayPossibleMarks;
    finalScore = totalPossible > 0 ? (totalAwarded / totalPossible) * 100 : 0;
    rankingLevel = calculateRankingLevel(finalScore, {
      thresholdSuperior: session.exam.thresholdSuperior,
      thresholdAboveAverage: session.exam.thresholdAboveAverage,
      thresholdHighAverage: session.exam.thresholdHighAverage,
      thresholdAverage: session.exam.thresholdAverage,
    });
  }

  // Topic performance uses awarded marks, while correct/incorrect counts remain MCQ-only.
  // ── Persist in transaction ────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    // MCQ updates
    for (const update of mcqUpdates) {
      await tx.studentAnswer.update({
        where: { id: update.id },
        data: { isCorrect: update.isCorrect, awardedMarks: update.awardedMarks },
      });
    }

    // Essay updates (with AI feedback)
    for (const update of essayUpdates) {
      await tx.studentAnswer.update({
        where: { id: update.id },
        data: {
          isCorrect: update.isCorrect,
          awardedMarks: update.awardedMarks,
          bandLabel: update.bandLabel,
          bandDescriptor: update.bandDescriptor,
          aiModel: update.aiModel,
          ...(update.aiFeedback && { aiFeedback: update.aiFeedback }),
        },
      });
      await tx.essayAnswerScore.deleteMany({ where: { studentAnswerId: update.id } });
      if (update.criterionScores.length > 0) {
        await tx.essayAnswerScore.createMany({
          data: update.criterionScores.map((score) => ({
            studentAnswerId: update.id,
            aiRubricId: score.aiRubricId,
            criterionId: score.criterionId,
            criterionName: score.criterionName,
            score: score.score,
            maxScore: score.maxScore,
            feedback: score.feedback || null,
            strengths: score.strengths,
            improvements: score.improvements,
          })),
        });
      }
    }

    // Update session
    await tx.examSession.update({
      where: { id: sessionId },
      data: {
        status: sessionStatus,
        ...(finalScore !== null && { finalScore }),
        ...(rankingLevel !== null && { rankingLevel }),
        mcqScore,
        essayScore,
      },
    });

    // Update StudentPerformance per topic
    if (finalScore !== null) {
      const topicScores = new Map<string, { subjectId: string; awardedMarks: number; possibleMarks: number }>();

      for (const eq of examQuestions) {
        const topicId = eq.question.topicId;
        const subjectId = eq.question.subjectId;
        const answer = answerMap.get(eq.question.id);
        const maxMarks = normalizeQuestionMaxMarks(eq.question.maxMarks);

        let awardedMarks = 0;
        if (eq.question.type === "MCQ") {
          const isCorrect = Boolean(answer) &&
            answer?.studentAnswer.trim().toUpperCase() ===
            (eq.question.correctAnswer ?? "").trim().toUpperCase();
          awardedMarks = isCorrect ? maxMarks : 0;
        } else {
          const essayResult = answer ? essayUpdates.find((update) => update.id === answer.id) : undefined;
          if (essayResult?.pendingReview) continue;
          awardedMarks = essayResult?.awardedMarks ?? 0;
        }

        const existing = topicScores.get(topicId) ?? { subjectId, awardedMarks: 0, possibleMarks: 0 };
        topicScores.set(topicId, {
          subjectId,
          awardedMarks: existing.awardedMarks + awardedMarks,
          possibleMarks: existing.possibleMarks + maxMarks,
        });
      }

      for (const [topicId, { subjectId, awardedMarks, possibleMarks }] of topicScores.entries()) {
        const topicScore = possibleMarks > 0 ? (awardedMarks / possibleMarks) * 100 : 0;

        const perf = await tx.studentPerformance.findUnique({
          where: { studentId_topicId: { studentId: session.studentId, topicId } },
          select: { scoreAvg: true, attemptCount: true },
        });

        if (perf) {
          const newAvg = (perf.scoreAvg * perf.attemptCount + topicScore) / (perf.attemptCount + 1);
          await tx.studentPerformance.update({
            where: { studentId_topicId: { studentId: session.studentId, topicId } },
            data: { scoreAvg: newAvg, attemptCount: { increment: 1 } },
          });
        } else {
          await tx.studentPerformance.create({
            data: { studentId: session.studentId, subjectId, topicId, scoreAvg: topicScore, attemptCount: 1 },
          });
        }
      }
    }
  });

  const essayCount = examQuestions.filter((eq) => eq.question.type === "ESSAY").length;
  const loggedPendingReviewCount = pendingReviewCount;
  logger.info(
    {
      sessionId,
      studentId: session.studentId,
      finalScore,
      mcqScore,
      essayScore,
      rankingLevel,
      correctCount,
      totalQuestions,
      mcqAwardedMarks,
      mcqPossibleMarks,
      essayAwardedMarks,
      essayPossibleMarks,
      essayAiGraded: essayUpdates.length - loggedPendingReviewCount,
      essayPendingReview: loggedPendingReviewCount,
      essayCount,
    },
    "Session graded successfully"
  );

  if (sessionStatus === "GRADED") {
    await getExamAttemptSummary(prisma, session.exam.id, {
      sub: session.studentId,
      role: "STUDENT",
    });

    // Fire-and-forget: build flashcards from the newly graded mistakes. The
    // student can still trigger generation manually if this silently fails.
    generateFromMistakes(prisma, session.studentId, { limit: 50 }).catch(() => {});
  }

  if (pendingReviewCount > 0) {
    void createNotification(prisma, {
      userId: session.exam.createdBy,
      type: "EXAM_MANUAL_REVIEW_REQUIRED",
      title: "Exam Requires Manual Grading",
      message:
        pendingReviewCount === 1
          ? `A submission for \"${session.exam.title}\" needs manual review.`
          : `A submission for \"${session.exam.title}\" has ${pendingReviewCount} answers pending manual review.`,
      data: {
        examId: session.exam.id,
        sessionId,
        studentId: session.studentId,
        pendingReviewCount,
        status: sessionStatus,
        url: `/dashboard/exams/sessions/${sessionId}/review?examId=${session.exam.id}`,
      },
    }).catch((error: unknown) => {
      logger.error({ err: error, sessionId }, "Failed to send exam manual review notification");
    });
  }
}

export function createGradingWorker(
  redis: Redis,
  prisma: PrismaClient,
  logger: FastifyBaseLogger
) {
  const worker = new Worker<GradingJobData>(
    "grading",
    async (job) => {
      logger.info({ sessionId: job.data.sessionId, jobId: job.id }, "Processing grading job");
      await gradeSession(prisma, job.data.sessionId, logger);
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, sessionId: job?.data?.sessionId, err }, "Grading job failed");
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, sessionId: job.data.sessionId }, "Grading job completed");
  });

  return worker;
}
