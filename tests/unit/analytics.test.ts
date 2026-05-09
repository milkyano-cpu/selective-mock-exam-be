import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  buildStudentAnalytics,
  getLeaderboard,
  getMyAnalytics,
  getStudentAnalytics,
} from "../../src/modules/analytics/analytics.service.js";
import * as analyticsController from "../../src/modules/analytics/analytics.controller.js";

const now = new Date("2026-05-08T00:00:00.000Z");

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    examSession: {
      findMany: jest.fn(async () => [
        {
          id: "session-1",
          examId: "exam-1",
          finalScore: 95,
          rankingLevel: "SUPERIOR",
          totalTimeSeconds: 1800,
          endTime: new Date("2026-05-07T00:00:00.000Z"),
          exam: { title: "Mock Exam 1" },
        },
        {
          id: "session-2",
          examId: "exam-2",
          finalScore: 65,
          rankingLevel: null,
          totalTimeSeconds: null,
          endTime: null,
          exam: { title: "Mock Exam 2" },
        },
      ]),
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
        firstName: "Ryan",
        lastName: "Lee",
        profilePhoto: "https://cdn.example.com/ryan.webp",
      })),
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
            firstName: "Ryan",
            lastName: "Lee",
            profilePhoto: null,
            role: "STUDENT",
          },
        },
        {
          studentId: "student-1",
          finalScore: 80,
          student: {
            id: "student-1",
            firstName: "Ryan",
            lastName: "Lee",
            profilePhoto: null,
            role: "STUDENT",
          },
        },
        {
          studentId: "student-2",
          finalScore: 60,
          student: {
            id: "student-2",
            firstName: "Zoe",
            lastName: "White",
            profilePhoto: "https://cdn.example.com/zoe.webp",
            role: "STUDENT",
          },
        },
        {
          studentId: "admin-1",
          finalScore: 100,
          student: {
            id: "admin-1",
            firstName: "Admin",
            lastName: "User",
            profilePhoto: null,
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
      rankingLevel: "ABOVE_AVERAGE",
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
      subjectPerformance: [
        {
          subjectId: "subject-vr",
          subjectName: "Verbal Reasoning",
          scoreAvg: 60,
          topicCount: 2,
        },
        {
          subjectId: "subject-math",
          subjectName: "Mathematics",
          scoreAvg: 80,
          topicCount: 1,
        },
      ],
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
      subjectPerformance: [],
    });
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
          rankingLevel: "ABOVE_AVERAGE",
          totalExams: 2,
        },
        {
          rank: 2,
          studentId: "student-2",
          studentName: "Zoe White",
          avatarUrl: "https://cdn.example.com/zoe.webp",
          score: 60,
          rankingLevel: "HIGH_AVERAGE",
          totalExams: 1,
        },
      ],
      myRank: { rank: 2, score: 60 },
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
    expect(monthly.myRank).toEqual({ rank: null, score: null });
  });

  it("maps leaderboard ranking levels across score bands", async () => {
    const prisma = mockPrisma({
      examSession: {
        findMany: jest.fn(async () => [
          { studentId: "s90", finalScore: 90, student: { firstName: "A", lastName: "", profilePhoto: null, role: "STUDENT" } },
          { studentId: "s75", finalScore: 75, student: { firstName: "B", lastName: "", profilePhoto: null, role: "STUDENT" } },
          { studentId: "s60", finalScore: 60, student: { firstName: "C", lastName: "", profilePhoto: null, role: "STUDENT" } },
          { studentId: "s45", finalScore: 45, student: { firstName: "D", lastName: "", profilePhoto: null, role: "STUDENT" } },
          { studentId: "s44", finalScore: 44, student: { firstName: "E", lastName: "", profilePhoto: null, role: "STUDENT" } },
        ]),
      },
    });

    const result = await getLeaderboard(prisma as never, { period: "ALL_TIME" }, "s44");

    expect(result.entries.map((entry) => entry.rankingLevel)).toEqual([
      "SUPERIOR",
      "ABOVE_AVERAGE",
      "HIGH_AVERAGE",
      "AVERAGE",
      "LOW_AVERAGE",
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
});
