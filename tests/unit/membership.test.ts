import { describe, expect, it, jest } from "@jest/globals";
import {
  assertCanUsePracticeTopic,
  assertForumAccess,
  assertForumWriteAccess,
  assertPremiumStudentFeature,
  getPracticeAccess,
  requireStandardStudentFeature,
} from "../../src/utils/membership.js";

const subjectOneTopics = [
  {
    id: "topic-a",
    subjectId: "subject-1",
    name: "Algebra",
    isFreeTopic: false,
    subject: { id: "subject-1", name: "Maths" },
    _count: { questions: 0 },
  },
  {
    id: "topic-b",
    subjectId: "subject-1",
    name: "Fractions",
    isFreeTopic: true,
    subject: { id: "subject-1", name: "Maths" },
    _count: { questions: 3 },
  },
];

const allTopics = [
  ...subjectOneTopics,
  {
    id: "topic-c",
    subjectId: "subject-2",
    name: "Analogies",
    isFreeTopic: true,
    subject: { id: "subject-2", name: "Verbal Reasoning" },
    _count: { questions: 4 },
  },
];

function mockPrisma(
  tier: "BASIC" | "STANDARD" | "PREMIUM" = "BASIC",
  options: { isForumBanned?: boolean; activeMajorWarning?: boolean } = {}
) {
  return {
    user: {
      findUnique: jest.fn(async () => ({
        id: "student-1",
        role: "STUDENT",
        tier,
        isForumBanned: options.isForumBanned ?? false,
      })),
    },
    systemSetting: {
      findUnique: jest.fn(async () => null),
    },
    practiceSession: {
      count: jest.fn(async () => 0),
    },
    forumWarning: {
      findFirst: jest.fn(async () => (options.activeMajorWarning ? { id: "warning-1" } : null)),
    },
    topic: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const topic = allTopics.find((item) => item.id === where.id);
        return topic ? { subjectId: topic.subjectId, isFreeTopic: topic.isFreeTopic } : null;
      }),
      findMany: jest.fn(async ({ where }: { where?: { subjectId?: string; isFreeTopic?: boolean } } = {}) =>
        allTopics.filter((topic) => {
          if (where?.subjectId && topic.subjectId !== where.subjectId) return false;
          if (where?.isFreeTopic !== undefined && topic.isFreeTopic !== where.isFreeTopic) return false;
          return true;
        })
      ),
    },
  };
}

function mockReply() {
  const reply = {
    status: jest.fn<(statusCode: number) => unknown>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.status.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

describe("membership entitlement helpers", () => {
  it("allows only Premium students to use premium student features", async () => {
    await expect(
      assertPremiumStudentFeature(mockPrisma("BASIC") as never, { sub: "student-1", role: "STUDENT" }, "Pathways")
    ).rejects.toMatchObject({ statusCode: 403, message: "Pathways requires a Premium membership" });

    await expect(
      assertPremiumStudentFeature(mockPrisma("STANDARD") as never, { sub: "student-1", role: "STUDENT" }, "Flashcards")
    ).rejects.toMatchObject({ statusCode: 403, message: "Flashcards requires a Premium membership" });

    await expect(
      assertPremiumStudentFeature(mockPrisma("PREMIUM") as never, { sub: "student-1", role: "STUDENT" }, "Pathways")
    ).resolves.toBeUndefined();

    await expect(
      assertPremiumStudentFeature(mockPrisma("BASIC") as never, { sub: "tutor-1", role: "TUTOR" }, "Pathways")
    ).resolves.toBeUndefined();
  });

  it("restricts forum access to Premium students; parents/tutors/admins are exempt", async () => {
    // Students below Premium are blocked entirely (read + write).
    await expect(
      assertForumAccess(mockPrisma("BASIC") as never, { sub: "student-1", role: "STUDENT" })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Forum access requires a Premium membership.",
    });

    await expect(
      assertForumAccess(mockPrisma("STANDARD") as never, { sub: "student-1", role: "STUDENT" })
    ).rejects.toMatchObject({ statusCode: 403 });

    // Parents have forum access on any tier (no Premium requirement).
    await expect(
      assertForumAccess(mockPrisma("BASIC") as never, { sub: "parent-1", role: "PARENT" })
    ).resolves.toBeUndefined();

    // PREMIUM students are allowed.
    await expect(
      assertForumAccess(mockPrisma("PREMIUM") as never, { sub: "student-1", role: "STUDENT" })
    ).resolves.toBeUndefined();

    await expect(
      assertForumAccess(
        mockPrisma("PREMIUM", { isForumBanned: true }) as never,
        { sub: "student-1", role: "STUDENT" }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Your forum access has been suspended due to repeated violations.",
    });

    // Tutor and Admin bypass the tier check regardless of tier.
    await expect(
      assertForumAccess(mockPrisma("BASIC") as never, { sub: "tutor-1", role: "TUTOR" })
    ).resolves.toBeUndefined();
    await expect(
      assertForumAccess(mockPrisma("BASIC") as never, { sub: "admin-1", role: "ADMIN" })
    ).resolves.toBeUndefined();
  });

  it("restricts forum posting for 24 hours after a major warning", async () => {
    await expect(
      assertForumWriteAccess(mockPrisma("PREMIUM") as never, { sub: "student-1", role: "STUDENT" })
    ).resolves.toBeUndefined();

    await expect(
      assertForumWriteAccess(
        mockPrisma("PREMIUM", { activeMajorWarning: true }) as never,
        { sub: "student-1", role: "STUDENT" }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Posting is restricted for 24 hours after a major forum warning.",
    });
  });

  it("returns a Standard upgrade response for Basic students accessing Standard features", async () => {
    const preHandler = requireStandardStudentFeature("Analytics");
    const basicReply = mockReply();

    await preHandler(
      {
        user: { sub: "student-1", role: "STUDENT" },
        server: { prisma: mockPrisma("BASIC") },
      } as never,
      basicReply as never
    );

    expect(basicReply.status).toHaveBeenCalledWith(403);
    expect(basicReply.send).toHaveBeenCalledWith({
      success: false,
      error: "tier_required",
      message: "Analytics requires a Standard membership",
      requiredTier: "STANDARD",
      upgradeUrl: "/dashboard/billing",
    });

    const standardReply = mockReply();
    await preHandler(
      {
        user: { sub: "student-1", role: "STUDENT" },
        server: { prisma: mockPrisma("STANDARD") },
      } as never,
      standardReply as never
    );
    expect(standardReply.status).not.toHaveBeenCalled();

    const staffPrisma = mockPrisma("BASIC");
    const staffReply = mockReply();
    await preHandler(
      {
        user: { sub: "tutor-1", role: "TUTOR" },
        server: { prisma: staffPrisma },
      } as never,
      staffReply as never
    );
    expect(staffPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(staffReply.status).not.toHaveBeenCalled();
  });

  it("returns only the free published topic per subject for Basic practice access", async () => {
    const prisma = mockPrisma("BASIC");
    const result = await getPracticeAccess(prisma as never, "student-1");

    expect(prisma.topic.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        _count: {
          select: {
            questions: { where: { type: "MCQ", status: "PUBLISHED", isPracticeAllowed: true } },
          },
        },
      }),
    }));

    expect(result).toEqual({
      tier: "BASIC",
      fullPracticeAccess: false,
      freeTopics: [
        {
          subjectId: "subject-1",
          subjectName: "Maths",
          topicId: "topic-b",
          topicName: "Fractions",
          availableQuestions: 3,
        },
        {
          subjectId: "subject-2",
          subjectName: "Verbal Reasoning",
          topicId: "topic-c",
          topicName: "Analogies",
          availableQuestions: 4,
        },
      ],
      dailyUsage: { used: 0, limit: 5 },
    });
  });

  it("restricts Basic practice to the free topic and allows Standard/Premium full practice", async () => {
    await expect(assertCanUsePracticeTopic(mockPrisma("BASIC") as never, "student-1", "topic-b")).resolves.toBeUndefined();

    await expect(assertCanUsePracticeTopic(mockPrisma("BASIC") as never, "student-1", "topic-a")).rejects.toMatchObject({
      statusCode: 403,
      message: "Basic members can only practice free topics.",
    });

    await expect(assertCanUsePracticeTopic(mockPrisma("BASIC") as never, "student-1", null)).rejects.toMatchObject({
      statusCode: 403,
      message: "Basic members can only practice free topics.",
    });

    await expect(assertCanUsePracticeTopic(mockPrisma("STANDARD") as never, "student-1", null)).resolves.toBeUndefined();
    await expect(assertCanUsePracticeTopic(mockPrisma("PREMIUM") as never, "student-1", "topic-a")).resolves.toBeUndefined();
  });
});
