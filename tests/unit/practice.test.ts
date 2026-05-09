import { describe, expect, it, jest } from "@jest/globals";
import * as practice from "../../src/modules/practice/practice.service.js";
import { encryptField } from "../../src/utils/field-encryption.js";

const now = new Date("2026-05-08T00:00:00.000Z");
const endedAt = new Date("2026-05-08T00:30:00.000Z");

function question(id = "question-1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    contentText: `Question ${id}`,
    contentLatex: null,
    isLatexFormat: false,
    difficulty: "EASY",
    options: [{ key: "A", text: "Answer A" }],
    imageUrl: null,
    imageUrls: [],
    correctAnswer: "A",
    explanation: "Because A",
    topicId: "topic-1",
    subjectId: "subject-vr",
    ...overrides,
  };
}

function sessionQuestion(id = "question-1", order = 1, overrides: Record<string, unknown> = {}) {
  return {
    questionId: id,
    order,
    question: question(id),
    ...overrides,
  };
}

function practiceSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    studentId: "student-1",
    topicId: "topic-1",
    sourceType: "SELF_SELECTED",
    status: "IN_PROGRESS",
    difficulty: "EASY",
    questionCount: 2,
    startedAt: now,
    endedAt: null,
    topic: {
      id: "topic-1",
      name: "Analogies",
      subjectId: "subject-vr",
      subject: { id: "subject-vr", name: "Verbal Reasoning" },
    },
    student: { id: "student-1", fullName: encryptField("Ryan Lee") },
    sessionQuestions: [sessionQuestion("question-1", 1), sessionQuestion("question-2", 2)],
    answers: [],
    ...overrides,
  };
}

function performance(overrides: Record<string, unknown> = {}) {
  return {
    topicId: "topic-1",
    subjectId: "subject-vr",
    scoreAvg: 45,
    attemptCount: 2,
    topic: {
      id: "topic-1",
      name: "Analogies",
      subject: { id: "subject-vr", name: "Verbal Reasoning" },
      _count: { questions: 3 },
    },
    ...overrides,
  };
}

function createTx() {
  return {
    practiceSession: {
      create: jest.fn(async () => ({ id: "session-1", startedAt: now })),
      update: jest.fn(async () => ({ id: "session-1" })),
    },
    practiceSessionQuestion: {
      createMany: jest.fn(async () => ({ count: 2 })),
    },
    practiceAnswer: {
      createMany: jest.fn(async () => ({ count: 2 })),
    },
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const tx = createTx();
  return {
    tx,
    $transaction: jest.fn(async (callback: (txArg: typeof tx) => unknown) => callback(tx)),
    topic: {
      findUnique: jest.fn(async () => ({
        id: "topic-1",
        name: "Analogies",
        subject: { id: "subject-vr", name: "Verbal Reasoning" },
      })),
    },
    subject: {
      findUnique: jest.fn(async () => ({ id: "subject-vr", name: "Verbal Reasoning" })),
    },
    question: {
      findMany: jest.fn(async () => [{ id: "question-1" }, { id: "question-2" }]),
    },
    practiceAnswer: {
      findMany: jest.fn(async () => []),
    },
    practiceSessionQuestion: {
      findMany: jest.fn(async () => [sessionQuestion("question-1", 1), sessionQuestion("question-2", 2)]),
    },
    practiceSession: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => practiceSession()),
      count: jest.fn(async () => 1),
      findMany: jest.fn(async () => [
        practiceSession({
          status: "COMPLETED",
          endedAt,
          answers: [{ isCorrect: true }, { isCorrect: false }],
        }),
      ]),
    },
    studentPerformance: {
      findMany: jest.fn(async () => [performance()]),
      findUnique: jest.fn(async () => ({ scoreAvg: 50, attemptCount: 2 })),
      update: jest.fn(async () => performance()),
      create: jest.fn(async () => performance()),
    },
    user: {
      findUnique: jest.fn(async () => ({
        id: "student-1",
        role: "STUDENT",
        tier: "PREMIUM",
        fullName: encryptField("Ryan Lee"),
      })),
    },
    ...overrides,
  };
}

describe("practice service", () => {
  it("resumes an existing topic practice session", async () => {
    const existing = practiceSession();
    const prisma = mockPrisma({
      practiceSession: { ...mockPrisma().practiceSession, findFirst: jest.fn(async () => existing) },
    });

    const result = await practice.startPracticeSession(prisma as never, "student-1", {
      topicId: "topic-1",
      difficulty: "EASY",
      questionCount: 5,
      excludeCompleted: false,
      incorrectOnly: false,
    });

    expect(prisma.practiceSession.findFirst).toHaveBeenCalledWith({
      where: {
        studentId: "student-1",
        topicId: "topic-1",
        sourceType: "SELF_SELECTED",
        status: "IN_PROGRESS",
      },
      select: expect.any(Object),
    });
    expect(result).toMatchObject({
      sessionId: "session-1",
      topicName: "Analogies",
      difficulty: "EASY",
      status: "IN_PROGRESS",
      questions: expect.arrayContaining([expect.objectContaining({ questionId: "question-1" })]),
    });
  });

  it("creates a new subject practice session with history filters", async () => {
    const prisma = mockPrisma({
      practiceAnswer: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ questionId: "question-3" }] as never)
          .mockResolvedValueOnce([{ questionId: "question-1" }, { questionId: "question-3" }] as never),
      },
    });

    const result = await practice.startPracticeSession(prisma as never, "student-1", {
      subjectId: "subject-vr",
      difficulty: "ALL",
      questionCount: 5,
      excludeCompleted: true,
      incorrectOnly: true,
      subtopics: ["coding"],
    });

    expect(prisma.question.findMany).toHaveBeenCalledWith({
      where: {
        subjectId: "subject-vr",
        type: "MCQ",
        status: "PUBLISHED",
        subtopics: { hasSome: ["coding"] },
        id: { in: ["question-1"] },
      },
      select: { id: true },
    });
    expect(prisma.tx.practiceSession.create).toHaveBeenCalledWith({
      data: {
        studentId: "student-1",
        topicId: null,
        sourceType: "SELF_SELECTED",
        status: "IN_PROGRESS",
        difficulty: null,
        questionCount: 2,
      },
      select: { id: true, startedAt: true },
    });
    expect(result).toMatchObject({ subjectName: "Verbal Reasoning", questionCount: 2, difficulty: "ALL" });
  });

  it("rejects missing filters, missing topics, unavailable questions, and empty incorrect history", async () => {
    const noTopic = mockPrisma({ topic: { findUnique: jest.fn(async () => null) } });
    await expect(
      practice.startPracticeSession(noTopic as never, "student-1", {
        topicId: "missing",
        difficulty: "ALL",
        questionCount: 5,
      })
    ).rejects.toMatchObject({ statusCode: 404, message: "Topic not found" });

    const noIncorrect = mockPrisma({ practiceAnswer: { findMany: jest.fn(async () => []) } });
    await expect(
      practice.startPracticeSession(noIncorrect as never, "student-1", {
        subjectId: "subject-vr",
        difficulty: "ALL",
        questionCount: 5,
        incorrectOnly: true,
      })
    ).rejects.toMatchObject({ statusCode: 422, message: "No incorrect answers found in your history" });

    const noQuestions = mockPrisma({ question: { findMany: jest.fn(async () => []) } });
    await expect(
      practice.startPracticeSession(noQuestions as never, "student-1", {
        subjectId: "subject-vr",
        difficulty: "ALL",
        questionCount: 5,
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      message: "No published MCQ questions available for the selected filters",
    });
  });

  it("starts weak-area practice and lists recommendations", async () => {
    const prisma = mockPrisma();

    const result = await practice.startWeakAreaPracticeSession(prisma as never, "student-1", {
      weaknessThreshold: 60,
      questionCount: 5,
    });

    expect(prisma.studentPerformance.findMany).toHaveBeenCalledWith({
      where: { studentId: "student-1", scoreAvg: { lt: 60 } },
      orderBy: { scoreAvg: "asc" },
      take: 5,
      select: expect.any(Object),
    });
    expect(result).toMatchObject({
      sourceType: "RECOMMENDATION",
      weakTopics: [expect.objectContaining({ topicName: "Analogies", scoreAvg: 45 })],
      questionCount: 2,
    });

    const recommendations = await practice.getWeakAreaRecommendations(prisma as never, "student-1", {
      threshold: 70,
      limit: 3,
      subjectId: "subject-vr",
    });
    expect(recommendations).toEqual([
      {
        topicId: "topic-1",
        topicName: "Analogies",
        subjectId: "subject-vr",
        subjectName: "Verbal Reasoning",
        scoreAvg: 45,
        attemptCount: 2,
        availableQuestions: 3,
      },
    ]);
  });

  it("gets completed sessions with answers and blocks access by another student", async () => {
    const prisma = mockPrisma({
      practiceSession: {
        ...mockPrisma().practiceSession,
        findUnique: jest.fn(async () =>
          practiceSession({
            status: "COMPLETED",
            endedAt,
            answers: [
              { questionId: "question-1", studentAnswer: "A", isCorrect: true, timeSpentSeconds: 10 },
              { questionId: "question-2", studentAnswer: "B", isCorrect: false, timeSpentSeconds: 20 },
            ],
          })
        ),
      },
    });

    const result = await practice.getPracticeSession(prisma as never, "session-1", "student-1");
    expect(result).toMatchObject({
      status: "COMPLETED",
      endedAt: endedAt.toISOString(),
      answers: expect.arrayContaining([
        expect.objectContaining({ questionId: "question-1", correctAnswer: "A", isCorrect: true }),
      ]),
    });

    await expect(practice.getPracticeSession(prisma as never, "session-1", "other-student")).rejects.toMatchObject({
      statusCode: 403,
      message: "Access denied",
    });
  });

  it("submits practice sessions, grades answers, and updates topic performance", async () => {
    const prisma = mockPrisma();

    const result = await practice.submitPracticeSession(prisma as never, "session-1", "student-1", {
      answers: [
        { questionId: "question-1", studentAnswer: "a", timeSpentSeconds: 10 },
        { questionId: "question-2", studentAnswer: "B", timeSpentSeconds: 20 },
      ],
    });

    expect(prisma.tx.practiceAnswer.createMany).toHaveBeenCalledWith({
      data: [
        {
          sessionId: "session-1",
          questionId: "question-1",
          studentAnswer: "a",
          isCorrect: true,
          timeSpentSeconds: 10,
        },
        {
          sessionId: "session-1",
          questionId: "question-2",
          studentAnswer: "B",
          isCorrect: false,
          timeSpentSeconds: 20,
        },
      ],
    });
    expect(prisma.studentPerformance.update).toHaveBeenCalledWith({
      where: { studentId_topicId: { studentId: "student-1", topicId: "topic-1" } },
      data: { scoreAvg: 50, attemptCount: { increment: 1 } },
    });
    expect(result).toMatchObject({
      status: "COMPLETED",
      totalQuestions: 2,
      correctCount: 1,
      scorePercent: 50,
    });
  });

  it("rejects invalid practice submissions", async () => {
    const completed = mockPrisma({
      practiceSession: { ...mockPrisma().practiceSession, findUnique: jest.fn(async () => practiceSession({ status: "COMPLETED" })) },
    });
    await expect(
      practice.submitPracticeSession(completed as never, "session-1", "student-1", { answers: [] })
    ).rejects.toMatchObject({ statusCode: 409, message: "Practice session already completed" });

    await expect(
      practice.submitPracticeSession(mockPrisma() as never, "session-1", "student-1", {
        answers: [{ questionId: "outsider", studentAnswer: "A", timeSpentSeconds: 1 }],
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      message: "Question outsider does not belong to this session",
    });
  });

  it("lists sessions, creates tutor assignments, and lists tutor assignments", async () => {
    const prisma = mockPrisma({
      question: {
        findMany: jest.fn(async () => [
          { id: "question-1", topicId: "topic-1" },
          { id: "question-2", topicId: "topic-1" },
        ]),
      },
    });

    const sessions = await practice.listPracticeSessions(prisma as never, "student-1", {
      page: 1,
      limit: 10,
      topicId: "topic-1",
      status: "COMPLETED",
      sourceType: "SELF_SELECTED",
    });
    expect(sessions.data[0]).toMatchObject({
      sessionId: "session-1",
      status: "COMPLETED",
      scorePercent: 50,
      correctCount: 1,
    });

    const assignment = await practice.createTutorAssignment(prisma as never, "tutor-1", {
      studentId: "student-1",
      questionIds: ["question-1", "question-2"],
    });
    expect(assignment).toMatchObject({
      sessionId: "session-1",
      studentName: "Ryan Lee",
      topicId: "topic-1",
      sourceType: "TUTOR_ASSIGNED",
    });

    const assignments = await practice.listTutorAssignments(prisma as never, "tutor-1", {
      page: 1,
      limit: 10,
      status: "COMPLETED",
    });
    expect(assignments.data[0]).toMatchObject({
      sessionId: "session-1",
      studentName: "Ryan Lee",
      scorePercent: 50,
    });
  });
});
