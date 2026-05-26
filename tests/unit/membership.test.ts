import { describe, expect, it, jest } from "@jest/globals";
import {
  assertCanUsePracticeTopic,
  assertForumWriteAllowed,
  assertPremiumStudentFeature,
  getPracticeAccess,
} from "../../src/utils/membership.js";

const subjectOneTopics = [
  {
    id: "topic-a",
    subjectId: "subject-1",
    name: "Algebra",
    subject: { id: "subject-1", name: "Maths" },
    _count: { questions: 0 },
  },
  {
    id: "topic-b",
    subjectId: "subject-1",
    name: "Fractions",
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
    subject: { id: "subject-2", name: "Verbal Reasoning" },
    _count: { questions: 4 },
  },
];

function mockPrisma(tier: "BASIC" | "STANDARD" | "PREMIUM" = "BASIC") {
  return {
    user: {
      findUnique: jest.fn(async () => ({ id: "student-1", role: "STUDENT", tier })),
    },
    topic: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const topic = allTopics.find((item) => item.id === where.id);
        return topic ? { subjectId: topic.subjectId } : null;
      }),
      findMany: jest.fn(async ({ where }: { where?: { subjectId?: string } } = {}) =>
        where?.subjectId ? allTopics.filter((topic) => topic.subjectId === where.subjectId) : allTopics
      ),
    },
  };
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

  it("makes Basic students read-only in forum write flows", async () => {
    await expect(
      assertForumWriteAllowed(mockPrisma("BASIC") as never, { sub: "student-1", role: "STUDENT" })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Basic members can read the forum but cannot post or comment",
    });

    await expect(
      assertForumWriteAllowed(mockPrisma("STANDARD") as never, { sub: "student-1", role: "STUDENT" })
    ).resolves.toBeUndefined();

    await expect(
      assertForumWriteAllowed(mockPrisma("PREMIUM") as never, { sub: "student-1", role: "STUDENT" })
    ).resolves.toBeUndefined();
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
    });
  });

  it("restricts Basic practice to the free topic and allows Standard/Premium full practice", async () => {
    await expect(assertCanUsePracticeTopic(mockPrisma("BASIC") as never, "student-1", "topic-b")).resolves.toBeUndefined();

    await expect(assertCanUsePracticeTopic(mockPrisma("BASIC") as never, "student-1", "topic-a")).rejects.toMatchObject({
      statusCode: 403,
      message: "Basic members can only practice the first topic in each subject",
    });

    await expect(assertCanUsePracticeTopic(mockPrisma("BASIC") as never, "student-1", null)).rejects.toMatchObject({
      statusCode: 403,
      message: "Basic members can only practice the first topic in each subject",
    });

    await expect(assertCanUsePracticeTopic(mockPrisma("STANDARD") as never, "student-1", null)).resolves.toBeUndefined();
    await expect(assertCanUsePracticeTopic(mockPrisma("PREMIUM") as never, "student-1", "topic-a")).resolves.toBeUndefined();
  });
});
