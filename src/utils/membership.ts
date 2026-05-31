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

export async function getSettingValue(
  prisma: PrismaClient,
  key: string,
  fallback: number
): Promise<number> {
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  const parsed = setting ? parseInt(setting.value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

export function requireStandardStudentFeature(featureName = "This feature") {
  return async function standardStudentPreHandler(request: FastifyRequest, reply: FastifyReply) {
    if (request.user.role !== "STUDENT") return;

    const tier = await getFreshUserTier(request.server.prisma, request.user.sub);
    if (tier === "BASIC") {
      return reply.status(403).send({
        success: false,
        error: "tier_required",
        message: `${featureName} requires a Standard membership`,
        requiredTier: "STANDARD",
        upgradeUrl: "/dashboard/billing",
      });
    }
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
    where: { isFreeTopic: true },
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
  });

  if (topics.length === 0) return [];

  return topics.map((t) => ({
    subjectId: t.subjectId,
    subjectName: t.subject.name,
    topicId: t.id,
    topicName: t.name,
    availableQuestions: t._count.questions,
  }));
}

export async function getPracticeAccess(prisma: PrismaClient, studentId: string) {
  const student = await getStudentMembership(prisma, studentId);
  const fullPracticeAccess = hasFullPracticeAccess(student.tier);

  // Daily session usage is only meaningful for Basic (limited) members.
  let dailyUsage: { used: number; limit: number } | null = null;
  if (!fullPracticeAccess) {
    const limit = await getSettingValue(prisma, "BASIC_DAILY_PRACTICE_LIMIT", 5);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const used = await prisma.practiceSession.count({
      where: { studentId, startedAt: { gte: dayStart } },
    });
    dailyUsage = { used, limit };
  }

  return {
    tier: student.tier,
    fullPracticeAccess,
    freeTopics: fullPracticeAccess ? [] : await getFreePracticeTopics(prisma),
    dailyUsage,
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
    throw createHttpError(403, "Basic members can only practice free topics.");
  }

  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { isFreeTopic: true },
  });

  if (!topic?.isFreeTopic) {
    throw createHttpError(403, "Basic members can only practice free topics.");
  }
}

export async function assertCanUsePracticeSession(
  prisma: PrismaClient,
  studentId: string,
  session: { topicId: string | null }
) {
  await assertCanUsePracticeTopic(prisma, studentId, session.topicId);
}
