import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import {
  createFlashcard,
  deleteFlashcard,
  generateFromMistakes,
  getDueFlashcards,
  getFlashcardStats,
  listFlashcards,
  reviewFlashcard,
  updateFlashcard,
} from "../../src/modules/flashcards/flashcards.service.js";
import * as flashcardsController from "../../src/modules/flashcards/flashcards.controller.js";

const now = new Date("2026-05-08T00:00:00.000Z");
const yesterday = new Date("2026-05-07T00:00:00.000Z");
const tomorrow = new Date("2026-05-09T00:00:00.000Z");

function flashcard(overrides: Record<string, unknown> = {}) {
  return {
    id: "flashcard-1",
    studentId: "student-1",
    questionId: null,
    frontContent: "Front",
    backContent: "Back",
    createdAt: yesterday,
    review: {
      easeFactor: 2.5,
      intervalDays: 0,
      repetitions: 0,
      nextReviewDate: yesterday,
    },
    ...overrides,
  };
}

function serialized(overrides: Record<string, unknown> = {}) {
  return {
    id: "flashcard-1",
    questionId: null,
    frontContent: "Front",
    backContent: "Back",
    source: "manual",
    createdAt: yesterday.toISOString(),
    review: {
      easeFactor: 2.5,
      intervalDays: 0,
      repetitions: 0,
      nextReviewDate: yesterday.toISOString(),
      isDue: true,
    },
    ...overrides,
  };
}

function createTx() {
  return {
    flashcard: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: { data: Record<string, unknown> }) =>
        flashcard({
          id: "flashcard-created",
          questionId: args.data.questionId ?? null,
          frontContent: args.data.frontContent,
          backContent: args.data.backContent,
          review: null,
        })
      ),
      findUnique: jest.fn(async () =>
        flashcard({
          id: "flashcard-created",
          frontContent: "Trimmed front",
          backContent: "Trimmed back",
        })
      ),
      delete: jest.fn(async () => flashcard()),
    },
    flashcardReview: {
      create: jest.fn(async () => undefined),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const tx = createTx();
  return {
    tx,
    $transaction: jest.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)),
    flashcard: {
      findMany: jest.fn(async () => [flashcard()]),
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => flashcard()),
      findUnique: jest.fn(async () => flashcard()),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => flashcard(args.data)),
      delete: jest.fn(async () => flashcard()),
    },
    flashcardReview: {
      create: jest.fn(async () => undefined),
      upsert: jest.fn(async () => undefined),
    },
    question: {
      findUnique: jest.fn(async () => ({ id: "question-1" })),
    },
    studentAnswer: {
      findMany: jest.fn(async () => []),
    },
    ...overrides,
  };
}

function mockReply() {
  const reply = {
    status: jest.fn<(code: number) => typeof reply>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.status.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    query: { page: 1, limit: 20, dueOnly: false },
    params: { id: "flashcard-1" },
    body: {
      frontContent: " Front ",
      backContent: " Back ",
    },
    user: { sub: "student-1" },
    server: { prisma: mockPrisma() },
    ...overrides,
  };
}

describe("flashcards module", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("lists flashcards with due filtering and serialized review state", async () => {
    const prisma = mockPrisma();

    const result = await listFlashcards(prisma as never, "student-1", {
      page: 2,
      limit: 10,
      dueOnly: true,
    });

    expect(prisma.flashcard.findMany).toHaveBeenCalledWith({
      where: {
        studentId: "student-1",
        review: { nextReviewDate: { lte: now } },
      },
      skip: 10,
      take: 10,
      orderBy: [{ review: { nextReviewDate: "asc" } }, { createdAt: "desc" }],
      select: expect.any(Object),
    });
    expect(result).toEqual({
      data: [serialized()],
      meta: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it("keeps flashcard total pages at least one when empty", async () => {
    const prisma = mockPrisma({
      flashcard: {
        ...mockPrisma().flashcard,
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
      },
    });

    const result = await listFlashcards(prisma as never, "student-1", {
      page: 1,
      limit: 20,
      dueOnly: false,
    });

    expect(result.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
  });

  it("gets due flashcards ordered by review date", async () => {
    const prisma = mockPrisma();

    const result = await getDueFlashcards(prisma as never, "student-1", 5);

    expect(prisma.flashcard.findMany).toHaveBeenCalledWith({
      where: {
        studentId: "student-1",
        review: { nextReviewDate: { lte: now } },
      },
      take: 5,
      orderBy: [{ review: { nextReviewDate: "asc" } }, { createdAt: "asc" }],
      select: expect.any(Object),
    });
    expect(result).toEqual([serialized()]);
  });

  it("creates a manual flashcard with an initial review", async () => {
    const prisma = mockPrisma();

    const result = await createFlashcard(prisma as never, "student-1", {
      frontContent: " Trimmed front ",
      backContent: " Trimmed back ",
    });

    expect(prisma.tx.flashcard.create).toHaveBeenCalledWith({
      data: {
        studentId: "student-1",
        questionId: null,
        frontContent: "Trimmed front",
        backContent: "Trimmed back",
      },
      select: expect.any(Object),
    });
    expect(prisma.tx.flashcardReview.create).toHaveBeenCalledWith({
      data: {
        flashcardId: "flashcard-created",
        easeFactor: 2.5,
        intervalDays: 0,
        repetitions: 0,
        nextReviewDate: expect.any(Date),
      },
    });
    expect(result).toMatchObject({ id: "flashcard-created" });
  });

  it("rejects missing question sources and failed create lookups", async () => {
    const missingQuestionPrisma = mockPrisma({
      question: { findUnique: jest.fn(async () => null) },
    });

    await expect(
      createFlashcard(missingQuestionPrisma as never, "student-1", {
        questionId: "question-missing",
        frontContent: "Front",
        backContent: "Back",
      })
    ).rejects.toMatchObject({ statusCode: 404, message: "Question not found" });

    const failedPrisma = mockPrisma();
    failedPrisma.tx.flashcard.findUnique.mockResolvedValueOnce(null as never);
    await expect(
      createFlashcard(failedPrisma as never, "student-1", {
        frontContent: "Front",
        backContent: "Back",
      })
    ).rejects.toMatchObject({ statusCode: 500, message: "Failed to create flashcard" });
  });

  it("updates and deletes owned flashcards", async () => {
    const prisma = mockPrisma();

    const updated = await updateFlashcard(prisma as never, "student-1", "flashcard-1", {
      frontContent: " Updated front ",
    });
    await deleteFlashcard(prisma as never, "student-1", "flashcard-1");

    expect(prisma.flashcard.findFirst).toHaveBeenCalledWith({
      where: { id: "flashcard-1", studentId: "student-1" },
      select: expect.any(Object),
    });
    expect(prisma.flashcard.update).toHaveBeenCalledWith({
      where: { id: "flashcard-1" },
      data: { frontContent: "Updated front" },
      select: expect.any(Object),
    });
    expect(prisma.tx.flashcardReview.deleteMany).toHaveBeenCalledWith({ where: { flashcardId: "flashcard-1" } });
    expect(prisma.tx.flashcard.delete).toHaveBeenCalledWith({ where: { id: "flashcard-1" } });
    expect(updated.frontContent).toBe("Updated front");
  });

  it("throws 404 when the flashcard is not owned by the student", async () => {
    const prisma = mockPrisma({
      flashcard: {
        ...mockPrisma().flashcard,
        findFirst: jest.fn(async () => null),
      },
    });

    await expect(
      updateFlashcard(prisma as never, "student-1", "missing", { frontContent: "Nope" })
    ).rejects.toMatchObject({ statusCode: 404, message: "Flashcard not found" });
  });

  it("records review ratings using SM-2 intervals", async () => {
    const prisma = mockPrisma({
      flashcard: {
        ...mockPrisma().flashcard,
        findFirst: jest.fn(async () =>
          flashcard({
            review: {
              easeFactor: 2.5,
              intervalDays: 6,
              repetitions: 2,
              nextReviewDate: yesterday,
            },
          })
        ),
        findUnique: jest.fn(async () =>
          flashcard({
            review: {
              easeFactor: 2.6,
              intervalDays: 16,
              repetitions: 3,
              nextReviewDate: new Date("2026-05-24T00:00:00.000Z"),
            },
          })
        ),
      },
    });

    const result = await reviewFlashcard(prisma as never, "student-1", "flashcard-1", "good");

    expect(prisma.flashcardReview.upsert).toHaveBeenCalledWith({
      where: { flashcardId: "flashcard-1" },
      create: {
        flashcardId: "flashcard-1",
        easeFactor: 2.5,
        intervalDays: 15,
        repetitions: 3,
        nextReviewDate: new Date("2026-05-23T00:00:00.000Z"),
      },
      update: {
        easeFactor: 2.5,
        intervalDays: 15,
        repetitions: 3,
        nextReviewDate: new Date("2026-05-23T00:00:00.000Z"),
      },
    });
    expect(result.review.intervalDays).toBe(16);
  });

  it("resets review progress on again rating and handles cards without existing review", async () => {
    const prisma = mockPrisma({
      flashcard: {
        ...mockPrisma().flashcard,
        findFirst: jest.fn(async () => flashcard({ review: null })),
        findUnique: jest.fn(async () => flashcard()),
      },
    });

    await reviewFlashcard(prisma as never, "student-1", "flashcard-1", "again");

    expect(prisma.flashcardReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          easeFactor: 2.18,
          intervalDays: 0,
          repetitions: 0,
          nextReviewDate: now,
        }),
      })
    );
  });

  it("throws 404 if reviewed flashcard disappears after saving review", async () => {
    const prisma = mockPrisma({
      flashcard: {
        ...mockPrisma().flashcard,
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(
      reviewFlashcard(prisma as never, "student-1", "flashcard-1", "easy")
    ).rejects.toMatchObject({ statusCode: 404, message: "Flashcard not found" });
  });

  it("generates flashcards from graded mistakes and skips blank or duplicate questions", async () => {
    const prisma = mockPrisma({
      studentAnswer: {
        findMany: jest.fn(async () => [
          {
            question: {
              id: "question-1",
              questionText: "What is 2+2?",
              correctAnswer: "B",
              explanation: "Two plus two is four.",
              options: [
                { key: "A", text: "3" },
                { key: "B", text: "4" },
              ],
            },
          },
          {
            question: {
              id: "question-blank",
              questionText: "   ",
              correctAnswer: "",
              explanation: null,
              options: null,
            },
          },
          {
            question: {
              id: "question-existing",
              questionText: "Existing card?",
              correctAnswer: "A",
              explanation: null,
              options: [{ key: "A", text: "Yes" }],
            },
          },
        ]),
      },
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: (txArg: typeof prisma.tx) => Promise<unknown>) => {
        prisma.tx.flashcard.findFirst.mockResolvedValueOnce(null as never);
        prisma.tx.flashcard.create.mockResolvedValueOnce(
          flashcard({
            id: "flashcard-generated",
            questionId: "question-1",
            frontContent: "What is 2+2?",
            backContent: "Correct answer: B\n\n4\n\nTwo plus two is four.",
            review: null,
          }) as never
        );
        prisma.tx.flashcard.findUnique.mockResolvedValueOnce(
          flashcard({
            id: "flashcard-generated",
            questionId: "question-1",
            frontContent: "What is 2+2?",
            backContent: "Correct answer: B\n\n4\n\nTwo plus two is four.",
          }) as never
        );
        return callback(prisma.tx);
      })
      .mockImplementationOnce(async (callback: (txArg: typeof prisma.tx) => Promise<unknown>) => {
        prisma.tx.flashcard.findFirst.mockResolvedValueOnce({ id: "already-card" } as never);
        return callback(prisma.tx);
      });

    const result = await generateFromMistakes(prisma as never, "student-1", { limit: 10 });

    expect(prisma.studentAnswer.findMany).toHaveBeenCalledWith({
      where: {
        isCorrect: false,
        session: { studentId: "student-1", status: "GRADED" },
        question: { flashcards: { none: { studentId: "student-1" } } },
      },
      orderBy: { session: { endTime: "desc" } },
      take: 10,
      select: expect.any(Object),
    });
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.cards[0]).toMatchObject({
      id: "flashcard-generated",
      questionId: "question-1",
      source: "question",
      backContent: "Correct answer: B\n\n4\n\nTwo plus two is four.",
    });
  });

  it("returns flashcard stats", async () => {
    const prisma = mockPrisma({
      flashcard: {
        ...mockPrisma().flashcard,
        count: jest.fn().mockResolvedValueOnce(12 as never).mockResolvedValueOnce(5 as never).mockResolvedValueOnce(3 as never).mockResolvedValueOnce(9 as never),
      },
    });

    await expect(getFlashcardStats(prisma as never, "student-1")).resolves.toEqual({
      total: 12,
      due: 5,
      newCards: 3,
      reviewed: 9,
    });
  });

  it("handles flashcard controller responses", async () => {
    const request = mockRequest();
    const reply = mockReply();

    const listResponse = await flashcardsController.listFlashcardsHandler(request as never, reply as never);
    const dueResponse = await flashcardsController.getDueFlashcardsHandler(request as never, reply as never);
    const statsResponse = await flashcardsController.getFlashcardStatsHandler(request as never, reply as never);
    const createResponse = await flashcardsController.createFlashcardHandler(request as never, reply as never);
    const updateResponse = await flashcardsController.updateFlashcardHandler(request as never, reply as never);
    const reviewResponse = await flashcardsController.reviewFlashcardHandler(
      { ...request, body: { rating: "good" } } as never,
      reply as never
    );
    const deleteResponse = await flashcardsController.deleteFlashcardHandler(request as never, reply as never);
    const generateResponse = await flashcardsController.generateFromMistakesHandler(
      { ...request, body: { limit: 5 } } as never,
      reply as never
    );

    expect(listResponse).toMatchObject({ success: true, message: "Flashcards retrieved successfully" });
    expect(dueResponse).toMatchObject({ success: true, message: "Due flashcards retrieved successfully" });
    expect(statsResponse).toMatchObject({ success: true, message: "Flashcard stats retrieved successfully" });
    expect(createResponse).toMatchObject({ success: true, message: "Flashcard created successfully" });
    expect(updateResponse).toMatchObject({ success: true, message: "Flashcard updated successfully" });
    expect(reviewResponse).toMatchObject({ success: true, message: "Flashcard review recorded successfully" });
    expect(deleteResponse).toEqual({ success: true, message: "Flashcard deleted successfully" });
    expect(generateResponse).toMatchObject({ success: true, message: "Flashcards generated from mistakes" });
  });
});
