import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient, Tier } from "@prisma/client";
import { createHttpError } from "./http-error.js";

export type MembershipTier = Tier;

export type AuthActor = {
  sub: string;
  role: string;
};

export type FreePracticeTopic = {
  subjectId: string;
  subjectName: string;
  topicId: string;
  topicName: string;
  availableQuestions: number;
};

export const PAID_TIERS: MembershipTier[] = ["STANDARD", "PREMIUM"];

export function hasFullPracticeAccess(tier: MembershipTier) {
  return tier === "STANDARD" || tier === "PREMIUM";
}

export function hasPremiumAccess(tier: MembershipTier) {
  return tier === "PREMIUM";
}

async function getStudentMembership(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, tier: true },
  });

  if (!user || user.role !== "STUDENT") {
    throw createHttpError(404, "Student not found");
  }

  return user;
}

export async function getFreshUserTier(prisma: PrismaClient, userId: string): Promise<MembershipTier> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true },
  });

  if (!user) {
    throw createHttpError(404, "User not found");
  }

  return user.tier;
}

export async function assertPremiumStudentFeature(
  prisma: PrismaClient,
  actor: AuthActor,
  featureName = "This feature"
) {
  if (actor.role !== "STUDENT") return;

  const tier = await getFreshUserTier(prisma, actor.sub);
  if (!hasPremiumAccess(tier)) {
    throw createHttpError(403, `${featureName} requires a Premium membership`);
  }
}

export function requirePremiumStudentFeature(featureName?: string) {
  return async function premiumStudentPreHandler(request: FastifyRequest, _reply: FastifyReply) {
    await assertPremiumStudentFeature(request.server.prisma, request.user, featureName);
  };
}

export async function assertForumWriteAllowed(prisma: PrismaClient, actor: AuthActor) {
  if (actor.role !== "STUDENT") return;

  const tier = await getFreshUserTier(prisma, actor.sub);
  if (tier === "BASIC") {
    throw createHttpError(403, "Basic members can read the forum but cannot post or comment");
  }
}

export function requireForumWriteAccess() {
  return async function forumWritePreHandler(request: FastifyRequest, _reply: FastifyReply) {
    await assertForumWriteAllowed(request.server.prisma, request.user);
  };
}

export async function getFreePracticeTopics(prisma: PrismaClient): Promise<FreePracticeTopic[]> {
  const topics = await prisma.topic.findMany({
    select: {
      id: true,
      subjectId: true,
      name: true,
      subject: { select: { id: true, name: true } },
      _count: {
        select: {
          questions: { where: { type: "MCQ", status: "PUBLISHED", isPracticeAllowed: true } },
        },
      },
    },
    orderBy: [{ subjectId: "asc" }, { name: "asc" }, { id: "asc" }],
  });

  const firstBySubject = new Map<string, (typeof topics)[number]>();
  const firstPublishedBySubject = new Map<string, (typeof topics)[number]>();

  for (const topic of topics) {
    if (!firstBySubject.has(topic.subjectId)) {
      firstBySubject.set(topic.subjectId, topic);
    }

    if (topic._count.questions > 0 && !firstPublishedBySubject.has(topic.subjectId)) {
      firstPublishedBySubject.set(topic.subjectId, topic);
    }
  }

  return Array.from(firstBySubject.entries()).map(([subjectId, fallbackTopic]) => {
    const topic = firstPublishedBySubject.get(subjectId) ?? fallbackTopic;
    return {
      subjectId,
      subjectName: topic.subject.name,
      topicId: topic.id,
      topicName: topic.name,
      availableQuestions: topic._count.questions,
    };
  });
}

export async function getFreePracticeTopicForSubject(
  prisma: PrismaClient,
  subjectId: string
): Promise<FreePracticeTopic | null> {
  const topics = await prisma.topic.findMany({
    where: { subjectId },
    select: {
      id: true,
      subjectId: true,
      name: true,
      subject: { select: { id: true, name: true } },
      _count: {
        select: {
          questions: { where: { type: "MCQ", status: "PUBLISHED", isPracticeAllowed: true } },
        },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const topic = topics.find((item) => item._count.questions > 0) ?? topics[0] ?? null;
  if (!topic) return null;

  return {
    subjectId: topic.subjectId,
    subjectName: topic.subject.name,
    topicId: topic.id,
    topicName: topic.name,
    availableQuestions: topic._count.questions,
  };
}

export async function getPracticeAccess(prisma: PrismaClient, studentId: string) {
  const student = await getStudentMembership(prisma, studentId);
  const fullPracticeAccess = hasFullPracticeAccess(student.tier);

  return {
    tier: student.tier,
    fullPracticeAccess,
    freeTopics: fullPracticeAccess ? [] : await getFreePracticeTopics(prisma),
  };
}

export async function assertCanUsePracticeTopic(
  prisma: PrismaClient,
  studentId: string,
  topicId: string | null | undefined
) {
  const student = await getStudentMembership(prisma, studentId);
  if (hasFullPracticeAccess(student.tier)) return;

  if (!topicId) {
    throw createHttpError(403, "Basic members can only practice the first topic in each subject");
  }

  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { subjectId: true },
  });

  if (!topic) {
    throw createHttpError(404, "Topic not found");
  }

  const freeTopic = await getFreePracticeTopicForSubject(prisma, topic.subjectId);
  if (!freeTopic || freeTopic.topicId !== topicId) {
    throw createHttpError(403, "Basic members can only practice the first topic in each subject");
  }
}

export async function assertCanUsePracticeSession(
  prisma: PrismaClient,
  studentId: string,
  session: { topicId: string | null }
) {
  await assertCanUsePracticeTopic(prisma, studentId, session.topicId);
}
