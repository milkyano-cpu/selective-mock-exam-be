import { Prisma, type PrismaClient } from "@prisma/client";
import { createNotification } from "../../lib/notify.js";
import { createHttpError } from "../../utils/http-error.js";
import { decryptField } from "../../utils/field-encryption.js";
import {
  assertCanUsePracticeSession,
  assertCanUsePracticeTopic,
  getPracticeAccess,
} from "../../utils/membership.js";
import {
  IMAGE_SUMMARY_SELECT,
  resolveImagesAsBase64,
  serializeImageSummary,
  type ImageSummaryRecord,
} from "../images/images.service.js";
import type {
  StartPracticeBody,
  StartWeakAreaPracticeBody,
  GetRecommendationsQuery,
  SubmitPracticeBody,
  ListPracticeSessionsQuery,
  CreateAssignmentBody,
  ListAssignmentsQuery,
} from "./practice.schema.js";
import { buildEssayAiFeedback, gradeEssayWithAi, type AiRubricInput } from "../../utils/ai-grader.js";

// Strip server-only fields (like `aiModel`) from the persisted aiFeedback JSON
// before sending it to a student. Per final-design, the AI label must stay
// hidden from students.
function scrubAiFeedbackForStudent(aiFeedback: unknown) {
  if (!aiFeedback || typeof aiFeedback !== "object" || Array.isArray(aiFeedback)) return null;
  const { aiModel: _aiModel, ...rest } = aiFeedback as Record<string, unknown>;
  return rest;
}

// ── SELECT shapes ─────────────────────────────────────────────────────────────

const PASSAGE_SELECT_FOR_SESSION = {
  id: true,
  title: true,
  text: true,
  imageRef: true,
  imageDisplayPosition: true,
  image: { select: IMAGE_SUMMARY_SELECT },
} satisfies Prisma.PassageSelect;

const PRACTICE_QUESTION_SELECT = {
  questionId: true,
  order: true,
  question: {
    select: {
      id: true,
      type: true,
      questionText: true,
      writingType: true,
      promptText: true,
      markingGuide: true,
      markingType: true,
      maxMarks: true,
      latexEnabled: true,
      difficulty: true,
      options: true,
      imageRefs: true,
      correctAnswer: true,
      explanation: true,
      aiRubric: {
        select: {
          id: true,
          name: true,
          totalMaxScore: true,
          bandDescriptors: {
            orderBy: [{ scoreMin: "asc" }, { scoreMax: "asc" }],
            select: { bandLabel: true, scoreMin: true, scoreMax: true, descriptor: true },
          },
          calibrationNotes: {
            orderBy: { sortOrder: "asc" },
            select: { category: true, instruction: true },
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
        },
      },
      passage: { select: PASSAGE_SELECT_FOR_SESSION },
    },
  },
} satisfies Prisma.PracticeSessionQuestionSelect;

const PRACTICE_QUESTION_WITH_ANSWER_SELECT = {
  questionId: true,
  order: true,
  question: {
    select: {
      id: true,
      type: true,
      questionText: true,
      writingType: true,
      promptText: true,
      markingGuide: true,
      markingType: true,
      maxMarks: true,
      latexEnabled: true,
      difficulty: true,
      options: true,
      imageRefs: true,
      correctAnswer: true,
      explanation: true,
      aiRubric: {
        select: {
          id: true,
          name: true,
          totalMaxScore: true,
          bandDescriptors: {
            orderBy: [{ scoreMin: "asc" }, { scoreMax: "asc" }],
            select: { bandLabel: true, scoreMin: true, scoreMax: true, descriptor: true },
          },
          calibrationNotes: {
            orderBy: { sortOrder: "asc" },
            select: { category: true, instruction: true },
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
        },
      },
      topicId: true,
      subjectId: true,
      passage: { select: PASSAGE_SELECT_FOR_SESSION },
    },
  },
} satisfies Prisma.PracticeSessionQuestionSelect;

// ── Formatters ────────────────────────────────────────────────────────────────

function formatDifficulty(difficulty: string | null): "ALL" | "EASY" | "MEDIUM" | "HARD" {
  if (!difficulty) return "ALL";
  return difficulty as "EASY" | "MEDIUM" | "HARD";
}

function formatQuestion(sq: {
  questionId: string;
  order: number;
  question: {
    id: string;
    type: string;
    questionText: string;
    writingType: string | null;
    promptText: string | null;
    latexEnabled: boolean;
    difficulty: string;
    options: unknown;
    imageRefs: string[];
    maxMarks: number;
    passage?: {
      id: string;
      title: string | null;
      text: string | null;
      imageRef: string | null;
      imageDisplayPosition: string | null;
      image: ImageSummaryRecord | null;
    } | null;
  };
}, imagesByFileName?: Map<string, ImageSummaryRecord>) {
  const passage = sq.question.passage ?? null;
  return {
    questionId: sq.questionId,
    order: sq.order,
    type: sq.question.type as "MCQ" | "ESSAY",
    questionText: sq.question.questionText,
    writingType: sq.question.writingType,
    promptText: sq.question.promptText,
    latexEnabled: sq.question.latexEnabled,
    difficulty: sq.question.difficulty as "EASY" | "MEDIUM" | "HARD",
    options: sq.question.options as Array<{ key: string; text: string }> | null,
    imageRefs: sq.question.imageRefs,
    images: sq.question.imageRefs.map((fileName) => {
      const found = imagesByFileName?.get(fileName);
      return {
        fileName,
        url: found?.url ?? null,
        altText: found?.altText ?? null,
        caption: found?.caption ?? null,
      };
    }),
    correctAnswer: sq.question.type === "MCQ" ? ((sq.question as any).correctAnswer as string) : "",
    explanation: (sq.question as any).explanation as string | null,
    maxMarks: sq.question.maxMarks,
    passage: passage
      ? {
          id: passage.id,
          title: passage.title,
          text: passage.text,
          imageRef: passage.imageRef,
          imageDisplayPosition: passage.imageDisplayPosition,
          image: serializeImageSummary(passage.image),
        }
      : null,
  };
}

function toAiRubricInput(aiRubric: AiRubricInput | null): AiRubricInput | null {
  if (!aiRubric || aiRubric.criteria.length === 0) return null;
  return aiRubric;
}

function normalizeQuestionMaxMarks(maxMarks: number) {
  return Number.isFinite(maxMarks) && maxMarks > 0 ? maxMarks : 1;
}


// ── Service functions ─────────────────────────────────────────────────────────

export async function getMyPracticeAccess(prisma: PrismaClient, studentId: string) {
  return getPracticeAccess(prisma, studentId);
}

export async function startPracticeSession(
  prisma: PrismaClient,
  studentId: string,
  body: StartPracticeBody
) {
  await assertCanUsePracticeTopic(prisma, studentId, body.topicId ?? null);

  // 1. Resolve topic/subject metadata
  let topicMeta: { id: string; name: string; subject: { id: string; name: string } } | null = null;
  let subjectMeta: { id: string; name: string } | null = null;

  if (body.topicId) {
    const topic = await prisma.topic.findUnique({
      where: { id: body.topicId },
      select: { id: true, name: true, subject: { select: { id: true, name: true } } },
    });
    if (!topic) throw createHttpError(404, "Topic not found");
    topicMeta = topic;
    subjectMeta = topic.subject;

    // Resume existing IN_PROGRESS session for same topic
    const existing = await prisma.practiceSession.findFirst({
      where: {
        studentId,
        topicId: body.topicId,
        sourceType: "SELF_SELECTED",
        status: "IN_PROGRESS",
      },
      select: {
        id: true,
        status: true,
        sourceType: true,
        difficulty: true,
        questionCount: true,
        startedAt: true,
        sessionQuestions: {
          orderBy: { order: "asc" },
          select: PRACTICE_QUESTION_SELECT,
        },
      },
    });

    if (existing) {
      return {
        sessionId: existing.id,
        topicId: topic.id,
        topicName: topic.name,
        subjectId: topic.subject.id,
        subjectName: topic.subject.name,
        sourceType: "SELF_SELECTED" as const,
        difficulty: formatDifficulty(existing.difficulty),
        questionCount: existing.questionCount,
        status: existing.status as "IN_PROGRESS",
        startedAt: existing.startedAt.toISOString(),
        questions: existing.sessionQuestions.map((sq) => formatQuestion(sq)),
      };
    }
  } else if (body.subjectId) {
    const subject = await prisma.subject.findUnique({
      where: { id: body.subjectId },
      select: { id: true, name: true },
    });
    if (!subject) throw createHttpError(404, "Subject not found");
    subjectMeta = subject;
  }

  // 2. Build question filter
  const baseWhere: Prisma.QuestionWhereInput = {
    ...(body.topicId ? { topicId: body.topicId } : {}),
    ...(body.subjectId && !body.topicId ? { subjectId: body.subjectId } : {}),
    status: "PUBLISHED",
    ...(body.difficulty !== "ALL"
      ? { difficulty: body.difficulty as "EASY" | "MEDIUM" | "HARD" }
      : {}),
    ...(body.subtopics && body.subtopics.length > 0
      ? { subtopics: { hasSome: body.subtopics } }
      : {}),
  };

  // 3. Resolve excludeCompleted / incorrectOnly
  let excludeIds: string[] = [];
  let includeIds: string[] | null = null;

  if (body.excludeCompleted) {
    const correct = await prisma.practiceAnswer.findMany({
      where: { session: { studentId }, isCorrect: true },
      select: { questionId: true },
      distinct: ["questionId"],
    });
    excludeIds = correct.map((a) => a.questionId);
  }

  if (body.incorrectOnly) {
    const incorrect = await prisma.practiceAnswer.findMany({
      where: { session: { studentId }, isCorrect: false },
      select: { questionId: true },
      distinct: ["questionId"],
    });
    if (incorrect.length === 0) {
      throw createHttpError(422, "No incorrect answers found in your history");
    }
    const incorrectSet = incorrect.map((a) => a.questionId);
    // If excludeCompleted is also on: remove ids that are now correct
    const excludeSet = new Set(excludeIds);
    includeIds = incorrectSet.filter((id) => !excludeSet.has(id));
    if (includeIds.length === 0) {
      throw createHttpError(422, "All your previously incorrect questions have since been answered correctly");
    }
  }

  const idFilter: Prisma.QuestionWhereInput =
    includeIds !== null
      ? { id: { in: includeIds } }
      : excludeIds.length > 0
      ? { id: { notIn: excludeIds } }
      : {};

  const allQuestionIds = await prisma.question.findMany({
    where: { ...baseWhere, ...idFilter },
    select: { id: true },
  });

  if (allQuestionIds.length === 0) {
    throw createHttpError(422, "No published questions available for the selected filters");
  }

  // 4. Shuffle and slice
  const count = Math.min(body.questionCount, allQuestionIds.length);
  const shuffled = allQuestionIds.sort(() => Math.random() - 0.5).slice(0, count);

  // 5. Create session + questions in transaction
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.practiceSession.create({
      data: {
        studentId,
        topicId: body.topicId ?? null,
        sourceType: "SELF_SELECTED",
        status: "IN_PROGRESS",
        difficulty: body.difficulty === "ALL" ? null : (body.difficulty as "EASY" | "MEDIUM" | "HARD"),
        questionCount: count,
      },
      select: { id: true, startedAt: true },
    });

    await tx.practiceSessionQuestion.createMany({
      data: shuffled.map((q, index) => ({
        sessionId: created.id,
        questionId: q.id,
        order: index + 1,
      })),
    });

    return created;
  });

  // 6. Fetch questions
  const sessionQuestions = await prisma.practiceSessionQuestion.findMany({
    where: { sessionId: session.id },
    orderBy: { order: "asc" },
    select: PRACTICE_QUESTION_SELECT,
  });

  return {
    sessionId: session.id,
    topicId: topicMeta?.id ?? null,
    topicName: topicMeta?.name ?? null,
    subjectId: subjectMeta?.id ?? null,
    subjectName: subjectMeta?.name ?? null,
    sourceType: "SELF_SELECTED" as const,
    difficulty: formatDifficulty(body.difficulty === "ALL" ? null : body.difficulty),
    questionCount: count,
    status: "IN_PROGRESS" as const,
    startedAt: session.startedAt.toISOString(),
    questions: sessionQuestions.map((sq) => formatQuestion(sq)),
  };
}

export async function startWeakAreaPracticeSession(
  prisma: PrismaClient,
  studentId: string,
  body: StartWeakAreaPracticeBody
) {
  await assertCanUsePracticeTopic(prisma, studentId, null);

  // 1. Find weak topics from StudentPerformance
  const weakPerformances = await prisma.studentPerformance.findMany({
    where: {
      studentId,
      scoreAvg: { lt: body.weaknessThreshold },
      ...(body.subjectId ? { subjectId: body.subjectId } : {}),
    },
    orderBy: { scoreAvg: "asc" },
    take: 5,
    select: {
      topicId: true,
      scoreAvg: true,
      topic: {
        select: {
          id: true,
          name: true,
          subject: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (weakPerformances.length === 0) {
    throw createHttpError(
      422,
      `No weak areas found. All your topic scores are above ${body.weaknessThreshold}%.`
    );
  }

  const weakTopicIds = weakPerformances.map((p) => p.topicId);

  // 2. Get questions from weak topics
  const allQuestionIds = await prisma.question.findMany({
    where: { topicId: { in: weakTopicIds }, type: "MCQ", status: "PUBLISHED" },
    select: { id: true },
  });

  if (allQuestionIds.length === 0) {
    throw createHttpError(422, "No questions available for your weak areas");
  }

  const count = Math.min(body.questionCount, allQuestionIds.length);
  const shuffled = allQuestionIds.sort(() => Math.random() - 0.5).slice(0, count);

  // 3. Create session
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.practiceSession.create({
      data: {
        studentId,
        topicId: null,
        sourceType: "RECOMMENDATION",
        status: "IN_PROGRESS",
        difficulty: null,
        questionCount: count,
      },
      select: { id: true, startedAt: true },
    });

    await tx.practiceSessionQuestion.createMany({
      data: shuffled.map((q, i) => ({
        sessionId: created.id,
        questionId: q.id,
        order: i + 1,
      })),
    });

    return created;
  });

  const sessionQuestions = await prisma.practiceSessionQuestion.findMany({
    where: { sessionId: session.id },
    orderBy: { order: "asc" },
    select: PRACTICE_QUESTION_SELECT,
  });

  return {
    sessionId: session.id,
    sourceType: "RECOMMENDATION" as const,
    weakTopics: weakPerformances.map((p) => ({
      topicId: p.topicId,
      topicName: p.topic.name,
      subjectId: p.topic.subject.id,
      subjectName: p.topic.subject.name,
      scoreAvg: p.scoreAvg,
    })),
    difficulty: "ALL" as const,
    questionCount: count,
    status: "IN_PROGRESS" as const,
    startedAt: session.startedAt.toISOString(),
    questions: sessionQuestions.map((sq) => formatQuestion(sq)),
  };
}

export async function getWeakAreaRecommendations(
  prisma: PrismaClient,
  studentId: string,
  query: GetRecommendationsQuery
) {
  await assertCanUsePracticeTopic(prisma, studentId, null);

  const weakAreas = await prisma.studentPerformance.findMany({
    where: {
      studentId,
      scoreAvg: { lt: query.threshold },
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    },
    orderBy: { scoreAvg: "asc" },
    take: query.limit,
    select: {
      topicId: true,
      scoreAvg: true,
      attemptCount: true,
      topic: {
        select: {
          id: true,
          name: true,
          subject: { select: { id: true, name: true } },
          _count: {
            select: {
              questions: { where: { type: "MCQ", status: "PUBLISHED" } },
            },
          },
        },
      },
    },
  });

  return weakAreas.map((p) => ({
    topicId: p.topicId,
    topicName: p.topic.name,
    subjectId: p.topic.subject.id,
    subjectName: p.topic.subject.name,
    scoreAvg: p.scoreAvg,
    attemptCount: p.attemptCount,
    availableQuestions: p.topic._count.questions,
  }));
}

export async function getPracticeSession(
  prisma: PrismaClient,
  sessionId: string,
  studentId: string
) {
  const session = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      topicId: true,
      sourceType: true,
      status: true,
      difficulty: true,
      questionCount: true,
      startedAt: true,
      endedAt: true,
      totalTimeSeconds: true,
      topic: { select: { id: true, name: true, subject: { select: { id: true, name: true } } } },
      sessionQuestions: {
        orderBy: { order: "asc" },
        select: PRACTICE_QUESTION_WITH_ANSWER_SELECT,
      },
      answers: {
        select: {
          questionId: true,
          studentAnswer: true,
          isCorrect: true,
          timeSpentSeconds: true,
          awardedMarks: true,
          aiFeedback: true,
          bandLabel: true,
          bandDescriptor: true,
          gradingStatus: true,
        },
      },
    },
  });

  if (!session) throw createHttpError(404, "Practice session not found");
  if (session.studentId !== studentId) throw createHttpError(403, "Access denied");
  await assertCanUsePracticeSession(prisma, studentId, session);

  const questions = session.sessionQuestions.map((sq) => formatQuestion(sq));
  const answerMap = new Map(session.answers.map((a) => [a.questionId, a]));

  const resultAnswers =
    session.status === "COMPLETED"
      ? session.sessionQuestions.map((sq) => {
          const ans = answerMap.get(sq.questionId);
          const q = sq.question as typeof sq.question & {
            correctAnswer: string;
            explanation: string | null;
          };
          const passage = (q as any).passage ?? null;
          return {
            questionId: sq.questionId,
            order: sq.order,
            type: q.type as "MCQ" | "ESSAY",
            questionText: q.questionText,
            writingType: q.writingType,
            promptText: q.promptText,
            latexEnabled: q.latexEnabled,
            difficulty: q.difficulty as "EASY" | "MEDIUM" | "HARD",
            options: q.options as Array<{ key: string; text: string }> | null,
            imageRefs: q.imageRefs,
            images: q.imageRefs.map((fileName) => ({ fileName, url: null, altText: null, caption: null })),
            correctAnswer: q.type === "MCQ" ? q.correctAnswer : "",
            explanation: q.explanation,
            maxMarks: normalizeQuestionMaxMarks(q.maxMarks),
            passage: passage
              ? {
                  id: passage.id,
                  title: passage.title,
                  text: passage.text,
                  imageRef: passage.imageRef,
                  imageDisplayPosition: passage.imageDisplayPosition,
                  image: serializeImageSummary(passage.image),
                }
              : null,
            studentAnswer: ans?.studentAnswer ?? "",
            isCorrect: ans?.isCorrect ?? false,
            timeSpentSeconds: ans?.timeSpentSeconds ?? 0,
            awardedMarks: ans?.awardedMarks !== null && ans?.awardedMarks !== undefined ? Number(ans.awardedMarks) : null,
            bandLabel: ans?.bandLabel ?? null,
            bandDescriptor: ans?.bandDescriptor ?? null,
            gradingStatus: ans?.gradingStatus ?? "GRADED",
            aiFeedback: scrubAiFeedbackForStudent(ans?.aiFeedback ?? null),
          };
        })
      : null;

  const sourceType = normalizeSourceType(session.sourceType);

  return {
    sessionId: session.id,
    topicId: session.topicId,
    topicName: session.topic?.name ?? null,
    subjectId: session.topic?.subject.id ?? null,
    subjectName: session.topic?.subject.name ?? null,
    sourceType,
    difficulty: formatDifficulty(session.difficulty),
    questionCount: session.questionCount,
    status: session.status as "IN_PROGRESS" | "COMPLETED",
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    totalTimeSeconds: session.totalTimeSeconds ?? null,
    questions,
    answers: resultAnswers,
  };
}

export async function submitPracticeSession(
  prisma: PrismaClient,
  sessionId: string,
  studentId: string,
  body: SubmitPracticeBody
) {
  // 1. Validate session
  const session = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      topicId: true,
      sourceType: true,
      pathwayNodeId: true,
      status: true,
      difficulty: true,
      questionCount: true,
      startedAt: true,
      topic: { select: { id: true, name: true, subjectId: true } },
      sessionQuestions: {
        select: PRACTICE_QUESTION_WITH_ANSWER_SELECT,
      },
    },
  });

  if (!session) throw createHttpError(404, "Practice session not found");
  if (session.studentId !== studentId) throw createHttpError(403, "Access denied");
  await assertCanUsePracticeSession(prisma, studentId, session);
  if (session.status === "COMPLETED") throw createHttpError(409, "Practice session already completed");

  // 2. Validate submitted question IDs belong to this session
  const validQuestionIds = new Set(session.sessionQuestions.map((sq) => sq.questionId));
  for (const answer of body.answers) {
    if (!validQuestionIds.has(answer.questionId)) {
      throw createHttpError(422, `Question ${answer.questionId} does not belong to this session`);
    }
  }

  // 3. Grade answers
  const endedAt = new Date();
  const elapsedSessionSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
  );

  const questionById = new Map(session.sessionQuestions.map((sq) => [sq.questionId, sq.question]));
  const gradedAnswers: Prisma.PracticeAnswerCreateManyInput[] = [];
  const essayScores: Array<{
    questionId: string;
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

  for (const answer of body.answers) {
    const question = questionById.get(answer.questionId);
    if (!question) continue;
    const maxMarks = normalizeQuestionMaxMarks(question.maxMarks);
    const timeSpentSeconds = Math.min(answer.timeSpentSeconds, elapsedSessionSeconds);

    if (question.type === "ESSAY") {
      // MANUAL essays: save answer without AI grading; awaits tutor manual scoring
      if (question.markingType === "MANUAL") {
        gradedAnswers.push({
          sessionId,
          questionId: answer.questionId,
          studentAnswer: answer.studentAnswer,
          isCorrect: false,
          timeSpentSeconds,
          awardedMarks: null,
          aiFeedback: Prisma.JsonNull,
          bandLabel: null,
          bandDescriptor: null,
          gradingStatus: "PENDING_REVIEW",
          aiModel: null,
        });
        continue;
      }
      const aiRubric = toAiRubricInput(question.aiRubric);
      if (!aiRubric || question.markingType !== "AI") {
        throw createHttpError(422, `Essay question ${answer.questionId} is not configured for AI grading`);
      }
      const promptImages = question.imageRefs && question.imageRefs.length > 0
        ? await resolveImagesAsBase64(prisma, question.imageRefs)
        : [];
      const aiResult = await gradeEssayWithAi({
        writingType: question.writingType,
        questionText: question.questionText,
        promptText: question.promptText,
        images: promptImages.map(({ data, mediaType }) => ({ data, mediaType })),
        markingGuide: question.markingGuide,
        studentAnswer: answer.studentAnswer,
        aiRubric,
      });
      // Per final-design Step 6: awardedMarks = Σ ai_score_per_criterion (raw sum)
      const awardedMarks = aiResult.totalAwardedMarks;

      gradedAnswers.push({
        sessionId,
        questionId: answer.questionId,
        studentAnswer: answer.studentAnswer,
        isCorrect: aiResult.isCorrect,
        timeSpentSeconds,
        awardedMarks,
        aiFeedback: buildEssayAiFeedback(aiResult) as unknown as Prisma.InputJsonValue,
        bandLabel: aiResult.bandLabel,
        bandDescriptor: aiResult.bandDescriptor,
        gradingStatus: "GRADED",
        aiModel: aiResult.aiModel,
      });
      essayScores.push({
        questionId: answer.questionId,
        criterionScores: aiResult.criterionScores.map((score) => ({
          ...score,
          aiRubricId: aiResult.aiRubric.id,
        })),
      });
      continue;
    }

    const isCorrect =
      answer.studentAnswer.trim().toUpperCase() ===
      (question.correctAnswer ?? "").trim().toUpperCase();
    gradedAnswers.push({
      sessionId,
      questionId: answer.questionId,
      studentAnswer: answer.studentAnswer,
      isCorrect,
      timeSpentSeconds,
      awardedMarks: isCorrect ? maxMarks : 0,
      aiFeedback: Prisma.JsonNull,
      bandLabel: null,
      bandDescriptor: null,
      gradingStatus: "GRADED",
      aiModel: null,
    });
  }
  const totalTimeSeconds = elapsedSessionSeconds;

  const correctCount = gradedAnswers.filter((a) => a.isCorrect).length;
  const totalQuestions = session.sessionQuestions.length;
  const totalAwardedMarks = gradedAnswers.reduce((sum, answer) => sum + Number(answer.awardedMarks ?? 0), 0);
  const totalPossibleMarks = session.sessionQuestions.reduce((sum, sq) => sum + normalizeQuestionMaxMarks(sq.question.maxMarks), 0);
  const scorePercent = totalPossibleMarks > 0 ? (totalAwardedMarks / totalPossibleMarks) * 100 : 0;

  // 4. Persist answers + complete session
  // Pre-compute topic performance updates outside the tx (pure computation)
  type TopicPerfUpdate = { topicId: string; subjectId: string; scorePercent: number };
  const topicPerfUpdates: TopicPerfUpdate[] = [];
  if (session.topicId && session.topic) {
    topicPerfUpdates.push({
      topicId: session.topicId,
      subjectId: session.topic.subjectId,
      scorePercent,
    });
  } else {
    const topicGroups = new Map<string, { subjectId: string; correct: number; total: number }>();
    for (const sq of session.sessionQuestions) {
      const q = sq.question as typeof sq.question & { topicId: string; subjectId: string };
      const graded = gradedAnswers.find((g) => g.questionId === sq.questionId);
      const existing = topicGroups.get(q.topicId) ?? { subjectId: q.subjectId, correct: 0, total: 0 };
      topicGroups.set(q.topicId, {
        subjectId: q.subjectId,
        correct: existing.correct + (graded?.isCorrect ? 1 : 0),
        total: existing.total + 1,
      });
    }
    for (const [topicId, { subjectId, correct, total }] of topicGroups.entries()) {
      topicPerfUpdates.push({
        topicId,
        subjectId,
        scorePercent: total > 0 ? (correct / total) * 100 : 0,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    const createdAnswers = await Promise.all(
      gradedAnswers.map((answer) =>
        tx.practiceAnswer.create({
          data: answer,
          select: { id: true, questionId: true },
        })
      )
    );
    const answerIdByQuestionId = new Map(createdAnswers.map((answer) => [answer.questionId, answer.id]));
    for (const essay of essayScores) {
      const practiceAnswerId = answerIdByQuestionId.get(essay.questionId);
      if (!practiceAnswerId) continue;
      if (essay.criterionScores.length === 0) continue;
      await tx.practiceEssayScore.createMany({
        data: essay.criterionScores.map((score) => ({
          practiceAnswerId,
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
    await tx.practiceSession.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", endedAt, totalTimeSeconds },
    });
    // Update StudentPerformance per topic INSIDE the same transaction
    for (const { topicId, subjectId, scorePercent: tps } of topicPerfUpdates) {
      await upsertTopicPerformance(tx, studentId, topicId, subjectId, tps);
    }
  });

  if (session.sourceType === "PATHWAY" && session.pathwayNodeId) {
    await completePathwayNodePractice(
      prisma,
      studentId,
      session.pathwayNodeId,
      correctCount,
      totalQuestions
    );
  }

  // 6. Build result
  const answerMap = new Map(body.answers.map((a) => [a.questionId, a]));

  const resultAnswers = session.sessionQuestions
    .sort((a, b) => a.order - b.order)
    .map((sq) => {
      const submitted = answerMap.get(sq.questionId);
      const graded = gradedAnswers.find((g) => g.questionId === sq.questionId);
      const q = sq.question as typeof sq.question & {
        correctAnswer: string;
        explanation: string | null;
      };
      const passage = (q as any).passage ?? null;
      return {
        questionId: sq.questionId,
        order: sq.order,
        type: q.type as "MCQ" | "ESSAY",
        questionText: q.questionText,
        writingType: q.writingType,
        promptText: q.promptText,
        latexEnabled: q.latexEnabled,
        difficulty: q.difficulty as "EASY" | "MEDIUM" | "HARD",
        options: q.options as Array<{ key: string; text: string }> | null,
        imageRefs: q.imageRefs,
        images: q.imageRefs.map((fileName) => ({ fileName, url: null, altText: null, caption: null })),
        correctAnswer: q.type === "MCQ" ? q.correctAnswer : "",
        explanation: q.explanation,
        maxMarks: normalizeQuestionMaxMarks(q.maxMarks),
        passage: passage
          ? {
              id: passage.id,
              title: passage.title,
              text: passage.text,
              imageRef: passage.imageRef,
              imageDisplayPosition: passage.imageDisplayPosition,
              image: serializeImageSummary(passage.image),
            }
          : null,
        studentAnswer: submitted?.studentAnswer ?? "",
        isCorrect: graded?.isCorrect ?? false,
        timeSpentSeconds: submitted?.timeSpentSeconds ?? 0,
        awardedMarks: graded?.awardedMarks !== null && graded?.awardedMarks !== undefined ? Number(graded.awardedMarks) : null,
        bandLabel: graded?.bandLabel ?? null,
        bandDescriptor: graded?.bandDescriptor ?? null,
        gradingStatus: graded?.gradingStatus ?? "GRADED",
        aiFeedback: scrubAiFeedbackForStudent(graded?.aiFeedback ?? null),
      };
    });

  return {
    sessionId: session.id,
    topicId: session.topicId,
    topicName: session.topic?.name ?? null,
    status: "COMPLETED" as const,
    totalQuestions,
    correctCount,
    scorePercent,
    endedAt: endedAt.toISOString(),
    totalTimeSeconds,
    answers: resultAnswers,
  };
}

export async function listPracticeSessions(
  prisma: PrismaClient,
  studentId: string,
  query: ListPracticeSessionsQuery
) {
  const { page, limit, topicId, status, sourceType } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.PracticeSessionWhereInput = {
    studentId,
    ...(topicId ? { topicId } : {}),
    ...(status ? { status: status as "IN_PROGRESS" | "COMPLETED" } : {}),
    ...(sourceType ? { sourceType } : {}),
  };

  const [total, sessions] = await Promise.all([
    prisma.practiceSession.count({ where }),
    prisma.practiceSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        topicId: true,
        sourceType: true,
        difficulty: true,
        questionCount: true,
        status: true,
        totalTimeSeconds: true,
        startedAt: true,
        endedAt: true,
        topic: { select: { id: true, name: true, subject: { select: { id: true, name: true } } } },
        answers: { select: { isCorrect: true } },
      },
    }),
  ]);

  const data = sessions.map((s) => {
    const correctCount =
      s.status === "COMPLETED" ? s.answers.filter((a) => a.isCorrect).length : null;
    const scorePercent =
      s.status === "COMPLETED" && s.questionCount > 0
        ? (correctCount! / s.questionCount) * 100
        : null;

    return {
      sessionId: s.id,
      topicId: s.topicId,
      topicName: s.topic?.name ?? null,
      subjectId: s.topic?.subject.id ?? null,
      subjectName: s.topic?.subject.name ?? null,
      sourceType: normalizeSourceType(s.sourceType),
      difficulty: formatDifficulty(s.difficulty),
      questionCount: s.questionCount,
      status: s.status as "IN_PROGRESS" | "COMPLETED",
      scorePercent,
      correctCount,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      totalTimeSeconds: s.totalTimeSeconds ?? null,
    };
  });

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function createTutorAssignment(
  prisma: PrismaClient,
  tutorId: string,
  body: CreateAssignmentBody
) {
  // 1. Verify student exists
  const student = await prisma.user.findUnique({
    where: { id: body.studentId, role: "STUDENT", deletedAt: null },
    select: { id: true, fullName: true },
  });
  if (!student) throw createHttpError(404, "Student not found");

  // 2. Verify all questions are published
  const questions = await prisma.question.findMany({
    where: { id: { in: body.questionIds }, status: "PUBLISHED" },
    select: { id: true, topicId: true },
  });

  if (questions.length !== body.questionIds.length) {
    throw createHttpError(422, "Some questions were not found or are not published");
  }

  // Determine topicId: use explicit override, else infer from questions if all share one topic
  const topicIds = [...new Set(questions.map((q) => q.topicId))];
  const resolvedTopicId = body.topicId ?? (topicIds.length === 1 ? topicIds[0] : null);
  const topic = resolvedTopicId
    ? await prisma.topic.findUnique({
        where: { id: resolvedTopicId },
        select: { id: true, name: true, subject: { select: { id: true, name: true } } },
      })
    : null;

  await assertCanUsePracticeTopic(prisma, body.studentId, resolvedTopicId);

  // 3. Create session + questions
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.practiceSession.create({
      data: {
        studentId: body.studentId,
        topicId: resolvedTopicId ?? null,
        sourceType: "TUTOR_ASSIGNED",
        assignedBy: tutorId,
        status: "IN_PROGRESS",
        questionCount: questions.length,
      },
      select: { id: true, startedAt: true },
    });

    await tx.practiceSessionQuestion.createMany({
      data: body.questionIds.map((qId, i) => ({
        sessionId: created.id,
        questionId: qId,
        order: i + 1,
      })),
    });

    return created;
  });

  void createNotification(prisma, {
    userId: body.studentId,
    type: "PRACTICE_ASSIGNED",
    title: "New Practice Assignment",
    message: topic
      ? `You have a new practice assignment for ${topic.name}.`
      : "You have a new practice assignment.",
    data: {
      sessionId: session.id,
      topicId: resolvedTopicId,
      topicName: topic?.name ?? null,
      subjectId: topic?.subject.id ?? null,
      subjectName: topic?.subject.name ?? null,
      questionCount: questions.length,
      url: `/dashboard/practice/sessions/${session.id}`,
    },
  }).catch(() => undefined);

  return {
    sessionId: session.id,
    studentId: body.studentId,
    studentName: decryptField(student.fullName),
    topicId: resolvedTopicId,
    sourceType: "TUTOR_ASSIGNED" as const,
    questionCount: questions.length,
    status: "IN_PROGRESS" as const,
    startedAt: session.startedAt.toISOString(),
  };
}

// ── POST /practice/sessions/:sessionId/retake ────────────────────────────────

export async function retakePracticeSession(
  prisma: PrismaClient,
  sessionId: string,
  studentId: string,
) {
  const original = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      topicId: true,
      sourceType: true,
      difficulty: true,
      status: true,
      sessionQuestions: {
        orderBy: { order: "asc" },
        select: { questionId: true, order: true },
      },
    },
  });

  if (!original) throw createHttpError(404, "Practice session not found");
  if (original.studentId !== studentId)
    throw createHttpError(403, "You do not have access to this session");
  if (original.status !== "COMPLETED")
    throw createHttpError(422, "Only completed sessions can be retaken");

  // Resolve topic / subject metadata
  let topicMeta: { id: string; name: string; subject: { id: string; name: string } } | null = null;
  if (original.topicId) {
    topicMeta = await prisma.topic.findUnique({
      where: { id: original.topicId },
      select: { id: true, name: true, subject: { select: { id: true, name: true } } },
    });
  }

  const questionIds = original.sessionQuestions.map((sq) => sq.questionId);

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.practiceSession.create({
      data: {
        studentId,
        topicId: original.topicId,
        sourceType: original.sourceType,
        status: "IN_PROGRESS",
        difficulty: original.difficulty,
        questionCount: questionIds.length,
      },
      select: { id: true, startedAt: true },
    });

    await tx.practiceSessionQuestion.createMany({
      data: questionIds.map((qId, i) => ({
        sessionId: created.id,
        questionId: qId,
        order: i + 1,
      })),
    });

    return created;
  });

  const sessionQuestions = await prisma.practiceSessionQuestion.findMany({
    where: { sessionId: session.id },
    orderBy: { order: "asc" },
    select: PRACTICE_QUESTION_SELECT,
  });

  return {
    sessionId: session.id,
    topicId: topicMeta?.id ?? null,
    topicName: topicMeta?.name ?? null,
    subjectId: topicMeta?.subject.id ?? null,
    subjectName: topicMeta?.subject.name ?? null,
    sourceType: original.sourceType,
    difficulty: formatDifficulty(original.difficulty),
    questionCount: questionIds.length,
    status: "IN_PROGRESS" as const,
    startedAt: session.startedAt.toISOString(),
    questions: sessionQuestions.map((sq) => formatQuestion(sq)),
  };
}

export async function listTutorAssignments(
  prisma: PrismaClient,
  tutorId: string,
  query: ListAssignmentsQuery
) {
  const { page, limit, studentId, status } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.PracticeSessionWhereInput = {
    assignedBy: tutorId,
    sourceType: "TUTOR_ASSIGNED",
    ...(studentId ? { studentId } : {}),
    ...(status ? { status: status as "IN_PROGRESS" | "COMPLETED" } : {}),
  };

  const [total, sessions] = await Promise.all([
    prisma.practiceSession.count({ where }),
    prisma.practiceSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        studentId: true,
        topicId: true,
        difficulty: true,
        questionCount: true,
        status: true,
        startedAt: true,
        endedAt: true,
        student: { select: { id: true, fullName: true } },
        topic: { select: { id: true, name: true, subject: { select: { id: true, name: true } } } },
        answers: { select: { isCorrect: true } },
      },
    }),
  ]);

  const data = sessions.map((s) => {
    const correctCount =
      s.status === "COMPLETED" ? s.answers.filter((a) => a.isCorrect).length : null;
    const scorePercent =
      s.status === "COMPLETED" && s.questionCount > 0
        ? (correctCount! / s.questionCount) * 100
        : null;

    return {
      sessionId: s.id,
      studentId: s.studentId,
      studentName: decryptField(s.student.fullName),
      topicId: s.topicId,
      topicName: s.topic?.name ?? null,
      subjectId: s.topic?.subject.id ?? null,
      subjectName: s.topic?.subject.name ?? null,
      difficulty: formatDifficulty(s.difficulty),
      questionCount: s.questionCount,
      status: s.status as "IN_PROGRESS" | "COMPLETED",
      scorePercent,
      correctCount,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
    };
  });

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeSourceType(
  sourceType: string
): "SELF_SELECTED" | "TUTOR_ASSIGNED" | "PATHWAY" | "RECOMMENDATION" {
  if (
    sourceType === "SELF_SELECTED" ||
    sourceType === "TUTOR_ASSIGNED" ||
    sourceType === "PATHWAY" ||
    sourceType === "RECOMMENDATION"
  ) {
    return sourceType;
  }
  return "SELF_SELECTED";
}

async function completePathwayNodePractice(
  prisma: PrismaClient,
  studentId: string,
  nodeId: string,
  correctAnswers: number,
  totalAttempts: number
) {
  const node = await prisma.pathwayNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      pathwayId: true,
      orderIndex: true,
      pathway: { select: { id: true, thresholdCorrect: true } },
    },
  });

  if (!node) return;

  const completedAt = correctAnswers >= node.pathway.thresholdCorrect ? new Date() : null;

  await prisma.pathwayNodeProgress.upsert({
    where: { nodeId_studentId: { nodeId, studentId } },
    create: {
      nodeId,
      studentId,
      correctAnswers,
      totalAttempts,
      isUnlocked: true,
      completedAt,
    },
    update: {
      correctAnswers,
      totalAttempts,
      completedAt,
    },
  });

  if (!completedAt) return;

  const nextNode = await prisma.pathwayNode.findFirst({
    where: { pathwayId: node.pathway.id, orderIndex: node.orderIndex + 1 },
    select: { id: true, topic: { select: { name: true } } },
  });

  if (!nextNode) return;

  await prisma.pathwayNodeProgress.upsert({
    where: { nodeId_studentId: { nodeId: nextNode.id, studentId } },
    create: { nodeId: nextNode.id, studentId, isUnlocked: true },
    update: { isUnlocked: true },
  });

  void createNotification(prisma, {
    userId: studentId,
    type: "PATHWAY_NODE_UNLOCKED",
    title: "New Topic Unlocked!",
    message: `Great job! You've unlocked the next topic: ${nextNode.topic.name}`,
    data: { pathwayId: node.pathwayId, nodeId: nextNode.id, topicName: nextNode.topic.name },
  }).catch(() => undefined);
}

async function upsertTopicPerformance(
  client: PrismaClient | Prisma.TransactionClient,
  studentId: string,
  topicId: string,
  subjectId: string,
  scorePercent: number
) {
  const perf = await client.studentPerformance.findUnique({
    where: { studentId_topicId: { studentId, topicId } },
    select: { scoreAvg: true, attemptCount: true },
  });

  if (perf) {
    const newAvg = (perf.scoreAvg * perf.attemptCount + scorePercent) / (perf.attemptCount + 1);
    await client.studentPerformance.update({
      where: { studentId_topicId: { studentId, topicId } },
      data: { scoreAvg: newAvg, attemptCount: { increment: 1 } },
    });
  } else {
    await client.studentPerformance.create({
      data: { studentId, subjectId, topicId, scoreAvg: scorePercent, attemptCount: 1 },
    });
  }
}
