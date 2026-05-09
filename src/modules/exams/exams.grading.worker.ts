import { Worker } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { Prisma, PrismaClient } from "@prisma/client";
import { gradeEssayWithAi, type AiRubricInput } from "../../utils/ai-grader.js";
import { createNotification } from "../../lib/notify.js";

export interface GradingJobData {
  sessionId: string;
}

const RUBRIC_FOR_AI_SELECT = {
  id: true,
  name: true,
  totalMaxScore: true,
  criteria: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      criterionName: true,
      criterionDescription: true,
      maxScore: true,
      bandDescriptors: {
        orderBy: [{ scoreMin: "asc" }, { scoreMax: "asc" }],
        select: {
          scoreMin: true,
          scoreMax: true,
          descriptor: true,
        },
      },
    },
  },
} satisfies Prisma.RubricSelect;

function toAiRubricInput(rubric: {
  id: string;
  name: string;
  totalMaxScore: number;
  criteria: Array<{
    id: string;
    criterionName: string;
    criterionDescription: string;
    maxScore: number;
    bandDescriptors: Array<{
      scoreMin: number;
      scoreMax: number;
      descriptor: string;
    }>;
  }>;
} | null): AiRubricInput | null {
  if (!rubric || rubric.criteria.length === 0) return null;
  return rubric;
}

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

async function gradeSession(prisma: PrismaClient, sessionId: string, logger: FastifyBaseLogger) {
  const session = await prisma.examSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      status: true,
      exam: {
        select: {
          id: true,
          title: true,
          createdBy: true,
          gradingType: true,
          questions: {
            select: {
              questionId: true,
              question: {
                select: {
                  id: true,
                  type: true,
                  contentText: true,
                  correctAnswer: true,
                  maxMarks: true,
                  subjectId: true,
                  topicId: true,
                  rubric: {
                    select: RUBRIC_FOR_AI_SELECT,
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
  const examQuestions = session.exam.questions;
  const totalQuestions = examQuestions.length;
  const gradingType = session.exam.gradingType === "MANUAL" ? "MANUAL" : "AUTO";
  const needsDefaultRubric = gradingType === "AUTO"
    && examQuestions.some((eq) => eq.question.type === "ESSAY" && !eq.question.rubric);
  const defaultRubric = needsDefaultRubric
    ? toAiRubricInput(await prisma.rubric.findFirst({
        where: { isDefault: true, isActive: true },
        select: RUBRIC_FOR_AI_SELECT,
      }))
    : null;

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
  let totalAwardedMarks = 0;
  let totalPossibleMarks = 0;

  for (const eq of examQuestions) {
    const question = eq.question;
    if (question.type !== "MCQ") continue;

    const maxMarks = normalizeQuestionMaxMarks(question.maxMarks);
    totalPossibleMarks += maxMarks;
    const answer = answerMap.get(question.id);
    if (!answer) continue;

    const isCorrect =
      answer.studentAnswer.trim().toUpperCase() ===
      question.correctAnswer.trim().toUpperCase();
    const awardedMarks = isCorrect ? maxMarks : 0;

    if (isCorrect) correctCount++;
    totalAwardedMarks += awardedMarks;
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
    criterionScores: Array<{
      criterionId: string;
      criterionName: string;
      score: number;
      maxScore: number;
      feedback: string;
      rubricId: string | null;
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
            criterionScores: [],
          };
        }

        const rubric = toAiRubricInput(question.rubric) ?? defaultRubric;
        const aiResult = await gradeEssayWithAi({
          questionText: question.contentText,
          correctAnswer: question.correctAnswer,
          studentAnswer: answer.studentAnswer,
          rubric,
        });

        if (aiResult) {
          const scorePercent = aiResult.scorePercent ?? (aiResult.isCorrect ? 100 : 0);
          const awardedMarks = scorePercentToAwardedMarks(scorePercent, maxMarks);
          const criterionScores = aiResult.criterionScores?.map((score) => ({
            ...score,
            rubricId: aiResult.rubric?.id ?? null,
          })) ?? [];
          logger.info(
            { sessionId, questionId: question.id, isCorrect: aiResult.isCorrect, confidence: aiResult.confidence, rubricId: rubric?.id, scorePercent, awardedMarks, maxMarks },
            "AI graded essay answer"
          );
          return { id: answer.id, isCorrect: aiResult.isCorrect, pendingReview: false, aiFeedback: aiResult, scorePercent, awardedMarks, maxMarks, criterionScores };
        }

        // AI unavailable — mark as pending review, do NOT count in score
        logger.warn({ sessionId, questionId: question.id }, "AI grading unavailable, marking essay as pending review");
        return {
          id: answer.id,
          isCorrect: false,
          pendingReview: true,
          scorePercent: 0,
          awardedMarks: 0,
          maxMarks,
          criterionScores: [],
          aiFeedback: {
            pendingReview: true,
            reason: "AI grading unavailable. Awaiting manual review by tutor.",
            gradedAt: new Date().toISOString(),
          },
        };
      })
    );

    for (const result of essayResults) {
      if (result.pendingReview) {
        pendingReviewCount++;
      } else if (result.isCorrect) {
        correctCount++;
      }
      if (!result.pendingReview) {
        totalAwardedMarks += result.awardedMarks;
        totalPossibleMarks += result.maxMarks;
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
          criterionScores: result.criterionScores,
        });
      }
    }
  }

  // ── Calculate final score ─────────────────────────────────────────────────
  let finalScore: number | null = null;
  let rankingLevel: ReturnType<typeof calculateRankingLevel> | null = null;
  const sessionStatus: "SUBMITTED" | "GRADED" = pendingReviewCount > 0 ? "SUBMITTED" : "GRADED";

  if (gradingType === "AUTO" && pendingReviewCount === 0) {
    finalScore = totalPossibleMarks > 0 ? (totalAwardedMarks / totalPossibleMarks) * 100 : 0;
    rankingLevel = calculateRankingLevel(finalScore);
  }

  // ── Build topic correctness map (includes AI-graded essays) ──────────────
  // Merge all graded results into a single map for StudentPerformance update
  const gradedCorrectMap = new Map<string, boolean>();
  for (const u of mcqUpdates) gradedCorrectMap.set(u.id, u.isCorrect);
  for (const u of essayUpdates) gradedCorrectMap.set(u.id, u.isCorrect);

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
          ...(update.aiFeedback && { aiFeedback: update.aiFeedback }),
        },
      });
      await tx.essayAnswerScore.deleteMany({ where: { studentAnswerId: update.id } });
      if (update.criterionScores.length > 0) {
        await tx.essayAnswerScore.createMany({
          data: update.criterionScores.map((score) => ({
            studentAnswerId: update.id,
            rubricId: score.rubricId,
            criterionId: score.criterionId,
            criterionName: score.criterionName,
            score: score.score,
            maxScore: score.maxScore,
            feedback: score.feedback || null,
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
      },
    });

    // Update StudentPerformance per topic
    if (finalScore !== null) {
      const topicScores = new Map<string, { subjectId: string; correct: number; total: number }>();

      for (const eq of examQuestions) {
        const topicId = eq.question.topicId;
        const subjectId = eq.question.subjectId;
        const answer = answerMap.get(eq.question.id);

        let isCorrect = false;
        if (answer) {
          if (eq.question.type === "MCQ") {
            isCorrect =
              answer.studentAnswer.trim().toUpperCase() ===
              eq.question.correctAnswer.trim().toUpperCase();
          } else {
            // Use AI-graded result; skip pending-review answers entirely
            const essayResult = essayUpdates.find((u) => u.id === answer.id);
            if (essayResult?.pendingReview) continue; // exclude from topic performance
            isCorrect = essayResult?.isCorrect ?? false;
          }
        }

        const existing = topicScores.get(topicId) ?? { subjectId, correct: 0, total: 0 };
        topicScores.set(topicId, {
          subjectId,
          correct: existing.correct + (isCorrect ? 1 : 0),
          total: existing.total + 1,
        });
      }

      for (const [topicId, { subjectId, correct, total }] of topicScores.entries()) {
        const topicScore = total > 0 ? (correct / total) * 100 : 0;

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
      rankingLevel,
      correctCount,
      totalQuestions,
      totalAwardedMarks,
      totalPossibleMarks,
      essayAiGraded: essayUpdates.length - loggedPendingReviewCount,
      essayPendingReview: loggedPendingReviewCount,
      essayCount,
    },
    "Session graded successfully"
  );

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
