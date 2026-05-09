import type {
  Notification as PrismaNotification,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { sendSseBroadcast, sendSseToUser } from "./sse-manager.js";
import { sendWebPush } from "./web-push.js";
import { getUserSubscriptions } from "../modules/push-subscriptions/push-subscriptions.service.js";

type PushSubscriptionTarget = {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function dispatchPushNotifications(
  prisma: PrismaClient,
  subscriptions: PushSubscriptionTarget[],
  notifications: PrismaNotification[]
) {
  const notificationMap = new Map(
    notifications.map((notification) => [notification.userId, notification])
  );

  for (const subscription of subscriptions) {
    const notification = notificationMap.get(subscription.userId);

    if (notification) {
      void sendWebPush(
        prisma,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        notification
      );
    }
  }
}

interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

export async function createNotification(
  prisma: PrismaClient,
  input: CreateNotificationInput
) {
  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      ...(input.data != null ? { data: input.data } : {}),
    },
  });

  sendSseBroadcast(
    [input.userId],
    "notification",
    notification
  );

  // Send Web Push asynchronously
  void getUserSubscriptions(prisma, input.userId)
    .then((subscriptions) => {
      dispatchPushNotifications(prisma, subscriptions, [notification]);
    })
    .catch((err: unknown) => console.error("[WebPush] Failed to fetch subscriptions", err));

  return notification;
}

interface NotifyAdminsInput {
  type: string;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

export async function notifyAdmins(
  prisma: PrismaClient,
  input: NotifyAdminsInput
) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });

  if (admins.length === 0) return [];

  const notifications = await prisma.notification.createManyAndReturn({
    data: admins.map((a) => ({
      userId: a.id,
      type: input.type,
      title: input.title,
      message: input.message,
      ...(input.data != null ? { data: input.data } : {}),
    })),
  });

  for (const notification of notifications) {
    sendSseToUser(notification.userId, "notification", notification);
  }

  // Send Web Push asynchronously to all admins
  const adminIds = admins.map((a) => a.id);
  void prisma.pushSubscription.findMany({
    where: { userId: { in: adminIds } },
    select: { userId: true, endpoint: true, p256dh: true, auth: true },
  })
    .then((subscriptions: PushSubscriptionTarget[]) => {
      dispatchPushNotifications(prisma, subscriptions, notifications);
    })
    .catch((err: unknown) => console.error("[WebPush] Failed to fetch admin subscriptions", err));

  return notifications;
}

interface NotifyByRolesInput {
  type: string;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

export async function notifyByRoles(
  prisma: PrismaClient,
  roles: string[],
  input: NotifyByRolesInput
) {
  const users = await prisma.user.findMany({
    where: { role: { in: roles as never[] }, status: "ACTIVE" },
    select: { id: true },
  });

  if (users.length === 0) return [];

  const notifications = await prisma.notification.createManyAndReturn({
    data: users.map((u) => ({
      userId: u.id,
      type: input.type,
      title: input.title,
      message: input.message,
      ...(input.data != null ? { data: input.data } : {}),
    })),
  });

  for (const notification of notifications) {
    sendSseToUser(notification.userId, "notification", notification);
  }

  // Send Web Push asynchronously to users with these roles
  const userIds = users.map((u) => u.id);
  void prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, endpoint: true, p256dh: true, auth: true },
  })
    .then((subscriptions: PushSubscriptionTarget[]) => {
      dispatchPushNotifications(prisma, subscriptions, notifications);
    })
    .catch((err: unknown) => console.error("[WebPush] Failed to fetch role subscriptions", err));

  return notifications;
}
