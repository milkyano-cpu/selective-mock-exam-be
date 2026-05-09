import type { PrismaClient } from "@prisma/client";
import type { ListNotificationsQuery } from "./notifications.schema.js";

export async function listNotifications(
  prisma: PrismaClient,
  userId: string,
  query: ListNotificationsQuery
) {
  const { page, limit, unreadOnly } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { userId };
  if (unreadOnly) {
    where.isRead = false;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    data: notifications,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getUnreadCount(
  prisma: PrismaClient,
  userId: string
): Promise<number> {
  return prisma.notification.count({
    where: { userId, isRead: false },
  });
}

export async function markAsRead(
  prisma: PrismaClient,
  userId: string,
  notificationId: string
) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function markAllAsRead(
  prisma: PrismaClient,
  userId: string
) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  return result.count;
}
