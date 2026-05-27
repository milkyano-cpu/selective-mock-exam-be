import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  buildStudentAnalytics,
  getLeaderboard,
  getMyAnalytics,
  getStudentAnalytics,
  serializeAnalyticsForTier,
} from "../../src/modules/analytics/analytics.service.js";
import * as analyticsController from "../../src/modules/analytics/analytics.controller.js";
import { analyticsRoutes } from "../../src/modules/analytics/analytics.route.js";
import { encryptField } from "../../src/utils/field-encryption.js";

const now = new Date("2026-05-08T00:00:00.000Z");

function studentIdentity(name: string, overrides: Record<string, unknown> = {}) {
  return {
    fullName: encryptField(name),
    profilePhotoKey: null,
    ...overrides,
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    examSession: {
      findMany: jest.fn(async ({ where }: { where?: { studentId?: unknown } } = {}) =>
        typeof where?.studentId === "string"
          ? [
              {
                id: "session-1",
                examId: "exam-1",
                finalScore: 95,
                rankingLevel: "SUPERIOR",
                totalTimeSeconds: 1800,
                endTime: new Date("2026-05-07T00:00:00.000Z"),
                attemptNumber: 1,
                exam: { title: "Mock Exam 1" },
              },
              {
                id: "session-2",
                examId: "exam-2",
                finalScore: 65,
                rankingLevel: null,
                totalTimeSeconds: null,
                endTime: null,
                attemptNumber: 2,
                exam: { title: "Mock Exam 2" },
              },
            ]
          : []
      ),
    },
    studentPerformance: {
      findMany: jest.fn(async () => [
        {
          topicId: "topic-1",
          scoreAvg: 50,
          attemptCount: 2,
          topic: { id: "topic-1", name: "Analogies" },
          subject: { id: "subject-vr", name: "Verbal Reasoning" },
        },
        {
          topicId: "topic-2",
          scoreAvg: 70,
          attemptCount: 3,
          topic: { id: "topic-2", name: "Logic" },
          subject: { id: "subject-vr", name: "Verbal Reasoning" },
        },
        {
          topicId: "topic-3",
          scoreAvg: 80,
          attemptCount: 1,
          topic: { id: "topic-3", name: "Number Patterns" },
          subject: { id: "subject-math", name: "Mathematics" },
        },
      ]),
    },
    user: {
      findUnique: jest.fn(async () => ({
        id: "student-1",
        tier: "STANDARD",
        ...studentIdentity("Ryan Lee", {
          profilePhotoKey: "https://cdn.example.com/ryan.webp",
        }),
      })),
    },
    essayAnswerScore: {
      findMany: jest.fn(async () => []),
    },
    ...overrides,
  };
}

function leaderboardPrisma() {
  return mockPrisma({
    examSession: {
      findMany: jest.fn(async () => [
        {
          studentId: "student-1",
          finalScore: 90,
          student: {
            id: "student-1",
            ...studentIdentity("Ryan Lee"),
            role: "STUDENT",
          },
        },
        {
          studentId: "student-1",
          finalScore: 80,
          student: {
            id: "student-1",
            ...studentIdentity("Ryan Lee"),
            role: "STUDENT",
          },
        },
        {
          studentId: "student-2",
          finalScore: 60,
          student: {
            id: "student-2",
            ...studentIdentity("Zoe White", {
              profilePhotoKey: "https://cdn.example.com/zoe.webp",
            }),
            role: "STUDENT",
          },
        },
        {
          studentId: "admin-1",
          finalScore: 100,
          student: {
            id: "admin-1",
            ...studentIdentity("Admin User"),
            role: "ADMIN",
          },
        },
      ]),
    },
  });
}

function mockReply() {
  const reply = {
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    query: { period: "ALL_TIME" },
    params: { studentId: "student-1" },
    user: { sub: "student-1" },
    server: { prisma: mockPrisma() },
    ...overrides,
  };
}

describe("analytics module", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds student analytics from graded sessions and topic performance", async () => {
    const prisma = mockPrisma();

    const result = await buildStudentAnalytics(prisma as never, "student-1");

    expect(prisma.examSession.findMany).toHaveBeenCalledWith({
      where: { studentId: "student-1", status: "GRADED" },
      orderBy: { endTime: "desc" },
      select: expect.any(Object),
    });
    expect(result).toEqual({
      overallAvg: 80,
      totalExams: 2,
      totalTimeSeconds: 1800,
      rankingLevel: "SUPERIOR",
      examHistory: [
        {
          sessionId: "session-1",
          examId: "exam-1",
          examTitle: "Mock Exam 1",
          finalScore: 95,
          rankingLevel: "SUPERIOR",
          totalTimeSeconds: 1800,
          takenAt: "2026-05-07T00:00:00.000Z",
        },
        {
          sessionId: "session-2",
          examId: "exam-2",
          examTitle: "Mock Exam 2",
          finalScore: 65,
          rankingLevel: null,
          totalTimeSeconds: null,
          takenAt: now.toISOString(),
        },
      ],
      topicPerformance: [
        {
          topicId: "topic-1",
          topicName: "Analogies",
          subjectId: "subject-vr",
          subjectName: "Verbal Reasoning",
          scoreAvg: 50,
          attemptCount: 2,
        },
        {
          topicId: "topic-2",
          topicName: "Logic",
          subjectId: "subject-vr",
          subjectName: "Verbal Reasoning",
          scoreAvg: 70,
          attemptCount: 3,
        },
        {
          topicId: "topic-3",
          topicName: "Number Patterns",
          subjectId: "subject-math",
          subjectName: "Mathematics",
          scoreAvg: 80,
          attemptCount: 1,
        },
      ],
      scoreHistory: [
        {
          sessionId: "session-1",
          examTitle: "Mock Exam 1",
          score: 95,
          rankingLevel: "SUPERIOR",
          takenAt: "2026-05-07T00:00:00.000Z",
          attemptNumber: 1,
        },
        {
          sessionId: "session-2",
          examTitle: "Mock Exam 2",
          score: 65,
          rankingLevel: null,
          takenAt: now.toISOString(),
          attemptNumber: 2,
        },
      ],
      subjectPerformance: [
        {
          subjectId: "subject-vr",
          subjectName: "Verbal Reasoning",
          scoreAvg: 60,
          topicCount: 2,
          bandLevel: "ABOVE_AVERAGE",
        },
        {
          subjectId: "subject-math",
          subjectName: "Mathematics",
          scoreAvg: 80,
          topicCount: 1,
          bandLevel: "SUPERIOR",
        },
      ],
      percentile: 0,
      writingPerformance: [],
    });
  });

  it("returns empty analytics when a student has no scored sessions", async () => {
    const prisma = mockPrisma({
      examSession: { findMany: jest.fn(async () => []) },
      studentPerformance: { findMany: jest.fn(async () => []) },
    });

    await expect(getMyAnalytics(prisma as never, "student-empty")).resolves.toEqual({
      overallAvg: null,
      totalExams: 0,
      totalTimeSeconds: 0,
      rankingLevel: null,
      examHistory: [],
      topicPerformance: [],
      scoreHistory: [],
      subjectPerformance: [],
      percentile: null,
      writingPerformance: [],
    });
  });

  it("orders score history chronologically and excludes sessions without scores", async () => {
    const prisma = mockPrisma({
      examSession: {
        findMany: jest.fn(async ({ where }: { where?: { studentId?: unknown } } = {}) =>
          typeof where?.studentId === "string"
            ? [
                {
                  id: "late",
                  examId: "exam-1",
                  finalScore: 88,
                  rankingLevel: "SUPERIOR",
                  totalTimeSeconds: 200,
                  endTime: new Date("2026-05-07T00:00:00.000Z"),
                  attemptNumber: 2,
                  exam: { title: "Second Attempt" },
                },
                {
                  id: "unscored",
                  examId: "exam-2",
                  finalScore: null,
                  rankingLevel: null,
                  totalTimeSeconds: 100,
                  endTime: new Date("2026-05-03T00:00:00.000Z"),
                  attemptNumber: 1,
                  exam: { title: "Pending Score" },
                },
                {
                  id: "early",
                  examId: "exam-1",
                  finalScore: 60,
                  rankingLevel: "ABOVE_AVERAGE",
                  totalTimeSeconds: 150,
                  endTime: new Date("2026-05-01T00:00:00.000Z"),
                  attemptNumber: 1,
                  exam: { title: "First Attempt" },
                },
              ]
            : []
        ),
      },
    });

    const result = await buildStudentAnalytics(prisma as never, "student-1");

    expect(result.scoreHistory).toEqual([
      expect.objectContaining({ sessionId: "early", score: 60, attemptNumber: 1 }),
      expect.objectContaining({ sessionId: "late", score: 88, attemptNumber: 2 }),
    ]);
  });

  it("computes percentile against other students' graded averages", async () => {
    const prisma = mockPrisma({
      examSession: {
        findMany: jest.fn(async ({ where }: { where?: { studentId?: unknown } } = {}) =>
          typeof where?.studentId === "string"
            ? [
                {
                  id: "mine",
                  examId: "exam-1",
                  finalScore: 80,
                  rankingLevel: "SUPERIOR",
                  totalTimeSeconds: 100,
                  endTime: new Date("2026-05-07T00:00:00.000Z"),
                  attemptNumber: 1,
                  exam: { title: "Mine" },
                },
              ]
            : [
                { studentId: "lower", finalScore: 60 },
                { studentId: "lower", finalScore: 70 },
                { studentId: "higher", finalScore: 90 },
              ]
        ),
      },
    });

    const result = await buildStudentAnalytics(prisma as never, "student-1");

    expect(result.percentile).toBe(50);
    expect(prisma.examSession.findMany).toHaveBeenCalledWith({
      where: {
        studentId: { not: "student-1" },
        status: "GRADED",
        finalScore: { not: null },
        student: { role: "STUDENT" },
      },
      select: {
        studentId: true,
        finalScore: true,
      },
    });
  });

  it("groups graded writing criteria by exam session with feedback arrays", async () => {
    const prisma = mockPrisma({
      essayAnswerScore: {
        findMany: jest.fn(async () => [
          {
            criterionName: "Ideas",
            score: 8,
            maxScore: 10,
            feedback: "Strong focus",
            strengths: ["Clear purpose"],
            improvements: ["Develop the conclusion"],
            studentAnswer: {
              bandLabel: "Strong",
              bandDescriptor: "Consistent control",
              session: {
                id: "essay-session",
                endTime: new Date("2026-05-05T00:00:00.000Z"),
                exam: { title: "Writing Exam" },
              },
            },
          },
          {
            criterionName: "Structure",
            score: 6,
            maxScore: 10,
            feedback: null,
            strengths: ["Organised paragraphs"],
            improvements: ["Improve transitions"],
            studentAnswer: {
              bandLabel: "Strong",
              bandDescriptor: "Consistent control",
              session: {
                id: "essay-session",
                endTime: new Date("2026-05-05T00:00:00.000Z"),
                exam: { title: "Writing Exam" },
              },
            },
          },
        ]),
      },
    });

    const result = await buildStudentAnalytics(prisma as never, "student-1");

    expect(prisma.essayAnswerScore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentAnswer: {
            session: {
              studentId: "student-1",
              status: "GRADED",
            },
          },
        },
      })
    );
    expect(result.writingPerformance).toEqual([
      {
        sessionId: "essay-session",
        examTitle: "Writing Exam",
        takenAt: "2026-05-05T00:00:00.000Z",
        bandLabel: "Strong",
        bandDescriptor: "Consistent control",
        criteria: [
          {
            criterionName: "Ideas",
            score: 8,
            maxScore: 10,
            scorePercent: 80,
            feedback: "Strong focus",
            strengths: ["Clear purpose"],
            improvements: ["Develop the conclusion"],
          },
          {
            criterionName: "Structure",
            score: 6,
            maxScore: 10,
            scorePercent: 60,
            feedback: null,
            strengths: ["Organised paragraphs"],
            improvements: ["Improve transitions"],
          },
        ],
      },
    ]);
  });

  it("serializes analytics fields according to the target membership tier", () => {
    const analytics = {
      studentId: "student-1",
      overallAvg: 80,
      totalExams: 2,
      totalTimeSeconds: 1800,
      rankingLevel: "SUPERIOR",
      examHistory: [],
      topicPerformance: [],
      scoreHistory: [{ score: 80 }],
      subjectPerformance: [{ subjectId: "subject-vr" }],
      percentile: 90,
      writingPerformance: [{ sessionId: "essay-session" }],
    };

    expect(serializeAnalyticsForTier(analytics, "BASIC")).toEqual({
      studentId: "student-1",
      overallAvg: 80,
      totalExams: 2,
      totalTimeSeconds: 1800,
      rankingLevel: "SUPERIOR",
      examHistory: [],
      topicPerformance: [],
    });
    expect(serializeAnalyticsForTier(analytics, "STANDARD")).toEqual({
      studentId: "student-1",
      overallAvg: 80,
      totalExams: 2,
      totalTimeSeconds: 1800,
      rankingLevel: "SUPERIOR",
      examHistory: [],
      topicPerformance: [],
      scoreHistory: [{ score: 80 }],
      subjectPerformance: [{ subjectId: "subject-vr" }],
      percentile: 90,
    });
    expect(serializeAnalyticsForTier(analytics, "PREMIUM")).toEqual(analytics);
  });

  it("returns named student analytics or null for missing students", async () => {
    const prisma = mockPrisma();

    const result = await getStudentAnalytics(prisma as never, "student-1");

    expect(result).toMatchObject({
      studentId: "student-1",
      studentName: "Ryan Lee",
      avatarUrl: "https://cdn.example.com/ryan.webp",
      overallAvg: 80,
    });

    const missingPrisma = mockPrisma({
      user: { findUnique: jest.fn(async () => null) },
    });
    await expect(getStudentAnalytics(missingPrisma as never, "missing")).resolves.toBeNull();
  });

  it("builds leaderboard entries and requester rank for all time", async () => {
    const prisma = leaderboardPrisma();

    const result = await getLeaderboard(prisma as never, { period: "ALL_TIME" }, "student-2");

    expect(prisma.examSession.findMany).toHaveBeenCalledWith({
      where: {
        status: "GRADED",
        finalScore: { not: null },
      },
      select: expect.any(Object),
    });
    expect(result).toEqual({
      period: "ALL_TIME",
      entries: [
        {
          rank: 1,
          studentId: "student-1",
          studentName: "Ryan Lee",
          avatarUrl: null,
          score: 85,
          rankingLevel: "SUPERIOR",
          totalExams: 2,
        },
        {
          rank: 2,
          studentId: "student-2",
          studentName: "Zoe White",
          avatarUrl: "https://cdn.example.com/zoe.webp",
          score: 60,
          rankingLevel: "ABOVE_AVERAGE",
          totalExams: 1,
        },
      ],
      myRank: {
        rank: 2,
        studentId: "student-2",
        studentName: "Zoe White",
        avatarUrl: "https://cdn.example.com/zoe.webp",
        score: 60,
        rankingLevel: "ABOVE_AVERAGE",
        totalExams: 1,
        percentile: 0,
      },
    });
  });

  it("applies weekly and monthly leaderboard period filters", async () => {
    const weeklyPrisma = leaderboardPrisma();
    await getLeaderboard(weeklyPrisma as never, { period: "WEEKLY" }, "unknown");

    expect(weeklyPrisma.examSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          endTime: { gte: new Date("2026-05-01T00:00:00.000Z") },
        }),
      })
    );

    const monthlyPrisma = leaderboardPrisma();
    const monthly = await getLeaderboard(monthlyPrisma as never, { period: "MONTHLY" }, "unknown");

    expect(monthlyPrisma.examSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          endTime: { gte: new Date("2026-04-08T00:00:00.000Z") },
        }),
      })
    );
    expect(monthly.myRank).toEqual({
      rank: null,
      studentId: "unknown",
      studentName: null,
      avatarUrl: null,
      score: null,
      rankingLevel: null,
      totalExams: null,
      percentile: null,
    });
  });

  it("maps leaderboard ranking levels across score bands", async () => {
    const prisma = mockPrisma({
      examSession: {
        findMany: jest.fn(async () => [
          { studentId: "s90", finalScore: 90, student: { ...studentIdentity("A"), role: "STUDENT" } },
          { studentId: "s75", finalScore: 75, student: { ...studentIdentity("B"), role: "STUDENT" } },
          { studentId: "s60", finalScore: 60, student: { ...studentIdentity("C"), role: "STUDENT" } },
          { studentId: "s45", finalScore: 45, student: { ...studentIdentity("D"), role: "STUDENT" } },
          { studentId: "s44", finalScore: 44, student: { ...studentIdentity("E"), role: "STUDENT" } },
        ]),
      },
    });

    const result = await getLeaderboard(prisma as never, { period: "ALL_TIME" }, "s44");

    expect(result.entries.map((entry) => entry.rankingLevel)).toEqual([
      "SUPERIOR",
      "SUPERIOR",
      "ABOVE_AVERAGE",
      "AVERAGE",
      "AVERAGE",
    ]);
  });

  it("handles analytics controller responses and missing student errors", async () => {
    const request = mockRequest({ server: { prisma: mockPrisma() } });
    const reply = mockReply();

    const meResponse = await analyticsController.getMyAnalyticsHandler(request as never, reply as never);
    const leaderboardResponse = await analyticsController.getLeaderboardHandler(
      { ...request, server: { prisma: leaderboardPrisma() } } as never,
      reply as never
    );
    const studentResponse = await analyticsController.getStudentAnalyticsHandler(request as never, reply as never);

    expect(meResponse).toMatchObject({ success: true, message: "OK" });
    expect(leaderboardResponse).toMatchObject({ success: true, message: "OK" });
    expect(studentResponse).toMatchObject({
      success: true,
      message: "OK",
      data: expect.objectContaining({ studentId: "student-1" }),
    });

    await expect(
      analyticsController.getStudentAnalyticsHandler(
        {
          ...request,
          server: { prisma: mockPrisma({ user: { findUnique: jest.fn(async () => null) } }) },
        } as never,
        reply as never
      )
    ).rejects.toMatchObject({ statusCode: 404, message: "Student not found" });
  });

  it("serializes staff and parent analytics using each target student's tier", async () => {
    const basicStudentPrisma = mockPrisma({
      user: {
        findUnique: jest.fn(async () => ({
          id: "student-1",
          tier: "BASIC",
          ...studentIdentity("Ryan Lee"),
        })),
      },
    });
    const basicStudentResponse = await analyticsController.getStudentAnalyticsHandler(
      mockRequest({ server: { prisma: basicStudentPrisma } }) as never,
      mockReply() as never
    ) as { data: Record<string, unknown> };
    expect(basicStudentResponse.data).not.toHaveProperty("subjectPerformance");

    const childrenPrisma = mockPrisma({
      parentStudentRelation: {
        findMany: jest.fn(async () => [
          { student: { id: "basic-child", ...studentIdentity("Basic Child") } },
          { student: { id: "premium-child", ...studentIdentity("Premium Child") } },
        ]),
      },
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
          tier: where.id === "basic-child" ? "BASIC" : "PREMIUM",
        })),
      },
    });
    const childrenResponse = await analyticsController.getChildrenAnalyticsHandler(
      mockRequest({
        user: { sub: "parent-1", role: "PARENT" },
        server: { prisma: childrenPrisma },
      }) as never,
      mockReply() as never
    ) as { data: Array<Record<string, unknown>> };

    expect(childrenResponse.data[0]).not.toHaveProperty("subjectPerformance");
    expect(childrenResponse.data[1]).toHaveProperty("subjectPerformance");
  });

  it("adds the Standard analytics gate only to personal and leaderboard routes", async () => {
    const fastify = {
      authenticate: jest.fn(),
      get: jest.fn(),
    };

    await analyticsRoutes(fastify as never);

    const meOptions = fastify.get.mock.calls[0]?.[1] as { preHandler: unknown[] };
    const leaderboardOptions = fastify.get.mock.calls[1]?.[1] as { preHandler: unknown[] };
    const childrenOptions = fastify.get.mock.calls[2]?.[1] as { preHandler: unknown[] };
    const studentOptions = fastify.get.mock.calls[3]?.[1] as { preHandler: unknown[] };

    expect(meOptions.preHandler).toHaveLength(2);
    expect(leaderboardOptions.preHandler).toHaveLength(2);
    expect(childrenOptions.preHandler).toHaveLength(2);
    expect(studentOptions.preHandler).toHaveLength(2);
    expect(meOptions.preHandler[1]).toBe(leaderboardOptions.preHandler[1]);
    expect(meOptions.preHandler[1]).not.toBe(childrenOptions.preHandler[1]);
    expect(meOptions.preHandler[1]).not.toBe(studentOptions.preHandler[1]);
  });
});
