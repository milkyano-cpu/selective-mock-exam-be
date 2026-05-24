import { Prisma, type PrismaClient } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";
import type {
  CreateFlashcardBody,
  GenerateFromMistakesBody,
  ListFlashcardsQuery,
  ReviewRating,
  UpdateFlashcardBody,
} from "./flashcards.schema.js";

const INITIAL_EASE_FACTOR = 2.5;
const MIN_EASE_FACTOR = 1.3;

const FLASHCARD_SELECT = {
  id: true,
  studentId: true,
  questionId: true,
  frontContent: true,
  backContent: true,
  createdAt: true,
  review: {
    select: {
      easeFactor: true,
      intervalDays: true,
      repetitions: true,
      nextReviewDate: true,
    },
  },
} satisfies Prisma.FlashcardSelect;

type FlashcardRecord = Prisma.FlashcardGetPayload<{ select: typeof FLASHCARD_SELECT }>;

function toNumber(value: Prisma.Decimal | number) {
  return typeof value === "number" ? value : value.toNumber();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getQuality(rating: ReviewRating) {
  if (rating === "again") return 2;
  if (rating === "hard") return 3;
  if (rating === "good") return 4;
  return 5;
}

function calculateSm2(params: {
  rating: ReviewRating;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  reviewedAt: Date;
}) {
  const quality = getQuality(params.rating);
  const easeDelta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  const easeFactor = Math.max(MIN_EASE_FACTOR, Number((params.easeFactor + easeDelta).toFixed(2)));

  if (quality < 3) {
    return {
      easeFactor,
      intervalDays: 0,
      repetitions: 0,
      nextReviewDate: addDays(params.reviewedAt, params.rating === "again" ? 0 : 1),
    };
  }

  const repetitions = params.repetitions + 1;
  let intervalDays: number;

  if (params.rating === "hard") {
    intervalDays = Math.max(1, Math.ceil(params.intervalDays * 1.2));
  } else if (repetitions === 1) {
    intervalDays = params.rating === "easy" ? 4 : 1;
  } else if (repetitions === 2) {
    intervalDays = params.rating === "easy" ? 8 : 6;
  } else {
    const multiplier = params.rating === "easy" ? easeFactor * 1.3 : easeFactor;
    intervalDays = Math.max(1, Math.ceil(params.intervalDays * multiplier));
  }

  return {
    easeFactor,
    intervalDays,
    repetitions,
    nextReviewDate: addDays(params.reviewedAt, intervalDays),
  };
}

function serializeFlashcard(card: FlashcardRecord, now = new Date()) {
  const review = card.review;
  const nextReviewDate = review?.nextReviewDate ?? card.createdAt;

  return {
    id: card.id,
    questionId: card.questionId,
    frontContent: card.frontContent,
    backContent: card.backContent,
    source: card.questionId ? "question" as const : "manual" as const,
    createdAt: card.createdAt.toISOString(),
    review: {
      easeFactor: review ? toNumber(review.easeFactor) : INITIAL_EASE_FACTOR,
      intervalDays: review?.intervalDays ?? 0,
      repetitions: review?.repetitions ?? 0,
      nextReviewDate: nextReviewDate.toISOString(),
      isDue: nextReviewDate.getTime() <= now.getTime(),
    },
  };
}

async function findOwnedFlashcard(prisma: PrismaClient, studentId: string, id: string) {
  const card = await prisma.flashcard.findFirst({
    where: { id, studentId },
    select: FLASHCARD_SELECT,
  });

  if (!card) throw createHttpError(404, "Flashcard not found");
  return card;
}

async function createReview(prisma: PrismaClient, flashcardId: string, nextReviewDate = new Date()) {
  await prisma.flashcardReview.create({
    data: {
      flashcardId,
      easeFactor: INITIAL_EASE_FACTOR,
      intervalDays: 0,
      repetitions: 0,
      nextReviewDate,
    },
  });
}

export async function listFlashcards(prisma: PrismaClient, studentId: string, query: ListFlashcardsQuery) {
  const { page, limit, dueOnly } = query;
  const skip = (page - 1) * limit;
  const now = new Date();
  const where: Prisma.FlashcardWhereInput = {
    studentId,
    ...(dueOnly ? { review: { nextReviewDate: { lte: now } } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.flashcard.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ review: { nextReviewDate: "asc" } }, { createdAt: "desc" }],
      select: FLASHCARD_SELECT,
    }),
    prisma.flashcard.count({ where }),
  ]);

  return {
    data: items.map((item) => serializeFlashcard(item, now)),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getDueFlashcards(prisma: PrismaClient, studentId: string, limit = 30) {
  const now = new Date();
  const cards = await prisma.flashcard.findMany({
    where: {
      studentId,
      review: { nextReviewDate: { lte: now } },
    },
    take: limit,
    orderBy: [{ review: { nextReviewDate: "asc" } }, { createdAt: "asc" }],
    select: FLASHCARD_SELECT,
  });

  return cards.map((card) => serializeFlashcard(card, now));
}

export async function createFlashcard(prisma: PrismaClient, studentId: string, body: CreateFlashcardBody) {
  if (body.questionId) {
    const question = await prisma.question.findUnique({ where: { id: body.questionId }, select: { id: true } });
    if (!question) throw createHttpError(404, "Question not found");
  }

  const card = await prisma.$transaction(async (tx) => {
    const created = await tx.flashcard.create({
      data: {
        studentId,
        questionId: body.questionId ?? null,
        frontContent: body.frontContent.trim(),
        backContent: body.backContent.trim(),
      },
      select: FLASHCARD_SELECT,
    });

    await createReview(tx as PrismaClient, created.id);

    const withReview = await tx.flashcard.findUnique({ where: { id: created.id }, select: FLASHCARD_SELECT });
    if (!withReview) throw createHttpError(500, "Failed to create flashcard");
    return withReview;
  });

  return serializeFlashcard(card);
}

export async function updateFlashcard(prisma: PrismaClient, studentId: string, id: string, body: UpdateFlashcardBody) {
  await findOwnedFlashcard(prisma, studentId, id);
  const updated = await prisma.flashcard.update({
    where: { id },
    data: {
      ...(body.frontContent !== undefined ? { frontContent: body.frontContent.trim() } : {}),
      ...(body.backContent !== undefined ? { backContent: body.backContent.trim() } : {}),
    },
    select: FLASHCARD_SELECT,
  });

  return serializeFlashcard(updated);
}

export async function deleteFlashcard(prisma: PrismaClient, studentId: string, id: string) {
  await findOwnedFlashcard(prisma, studentId, id);
  await prisma.flashcard.delete({ where: { id } });
}

export async function reviewFlashcard(prisma: PrismaClient, studentId: string, id: string, rating: ReviewRating) {
  const card = await findOwnedFlashcard(prisma, studentId, id);
  const existingReview = card.review ?? {
    easeFactor: new Prisma.Decimal(INITIAL_EASE_FACTOR),
    intervalDays: 0,
    repetitions: 0,
    nextReviewDate: new Date(),
  };
  const next = calculateSm2({
    rating,
    easeFactor: toNumber(existingReview.easeFactor),
    intervalDays: existingReview.intervalDays,
    repetitions: existingReview.repetitions,
    reviewedAt: new Date(),
  });

  await prisma.flashcardReview.upsert({
    where: { flashcardId: id },
    create: { flashcardId: id, ...next },
    update: next,
  });

  const updated = await prisma.flashcard.findUnique({ where: { id }, select: FLASHCARD_SELECT });
  if (!updated) throw createHttpError(404, "Flashcard not found");
  return serializeFlashcard(updated);
}

function buildBackContent(question: {
  correctAnswer: string | null;
  explanation: string | null;
  options: Prisma.JsonValue | null;
}) {
  const parts = [`Correct answer: ${question.correctAnswer || "Not provided"}`];
  if (question.explanation) parts.push(question.explanation);
  if (Array.isArray(question.options)) {
    const option = question.options.find((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      return "key" in item && item.key === question.correctAnswer;
    });
    if (option && typeof option === "object" && !Array.isArray(option) && "text" in option && typeof option.text === "string") {
      parts.splice(1, 0, option.text);
    }
  }
  return parts.join("\n\n");
}

export async function generateFromMistakes(prisma: PrismaClient, studentId: string, body: GenerateFromMistakesBody) {
  const wrongAnswers = await prisma.studentAnswer.findMany({
    where: {
      isCorrect: false,
      session: { studentId, status: "GRADED" },
      question: { flashcards: { none: { studentId } } },
    },
    orderBy: { session: { endTime: "desc" } },
    take: body.limit,
    select: {
      question: {
        select: {
          id: true,
          questionText: true,
          correctAnswer: true,
          explanation: true,
          options: true,
        },
      },
    },
  });

  const cards = [];
  let skipped = 0;

  for (const answer of wrongAnswers) {
    const question = answer.question;
    if (!question.questionText.trim()) {
      skipped++;
      continue;
    }

    const card = await prisma.$transaction(async (tx) => {
      const existing = await tx.flashcard.findFirst({
        where: { studentId, questionId: question.id },
        select: { id: true },
      });
      if (existing) return null;

      const created = await tx.flashcard.create({
        data: {
          studentId,
          questionId: question.id,
          frontContent: question.questionText.trim(),
          backContent: buildBackContent(question),
        },
        select: FLASHCARD_SELECT,
      });
      await createReview(tx as PrismaClient, created.id);
      return tx.flashcard.findUnique({ where: { id: created.id }, select: FLASHCARD_SELECT });
    });

    if (card) cards.push(serializeFlashcard(card));
    else skipped++;
  }

  return {
    created: cards.length,
    skipped,
    cards,
  };
}

export async function getFlashcardStats(prisma: PrismaClient, studentId: string) {
  const now = new Date();
  const [total, due, newCards, reviewed] = await Promise.all([
    prisma.flashcard.count({ where: { studentId } }),
    prisma.flashcard.count({ where: { studentId, review: { nextReviewDate: { lte: now } } } }),
    prisma.flashcard.count({ where: { studentId, review: { repetitions: 0 } } }),
    prisma.flashcard.count({ where: { studentId, review: { repetitions: { gt: 0 } } } }),
  ]);

  return { total, due, newCards, reviewed };
}
