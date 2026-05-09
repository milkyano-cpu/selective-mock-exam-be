import type { PrismaClient } from "@prisma/client";
import type { SubscribeBody } from "./push-subscriptions.schema.js";

export async function saveSubscription(
  prisma: PrismaClient,
  userId: string,
  body: SubscribeBody
) {
  const { subscription, userAgent } = body;
  const { endpoint, keys } = subscription;

  // Upsert to handle the case where a user resubscribes with same endpoint
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: {
      userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? null,
    },
    create: {
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? null,
    },
  });
}

export async function getUserSubscriptions(
  prisma: PrismaClient,
  userId: string
) {
  return prisma.pushSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteSubscription(
  prisma: PrismaClient,
  userId: string,
  endpoint: string
) {
  await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint },
  });
}
