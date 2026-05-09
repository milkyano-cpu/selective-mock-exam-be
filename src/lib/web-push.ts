import webPush from "web-push";
import type { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

type WebPushPayload = Record<string, unknown>;

type WebPushErrorLike = {
  statusCode?: number;
};

// Init web-push
// We will ensure keys are loaded properly later
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(
    env.VAPID_EMAIL || "mailto:admin@aspire.com",
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
}

export function getVapidPublicKey() {
  return env.VAPID_PUBLIC_KEY;
}

export async function sendWebPush(
  prisma: PrismaClient,
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: WebPushPayload
) {
  try {
    const subscription: webPush.PushSubscription = {
      endpoint,
      keys: { p256dh, auth },
    };

    await webPush.sendNotification(subscription, JSON.stringify(payload));
  } catch (error) {
    const webPushError = error as WebPushErrorLike;

    // If the error is a WebPushError and statusCode is 410 (Gone) or 404 (Not Found),
    // it means the subscription is no longer valid. We should remove it from the database.
    if (webPushError.statusCode === 410 || webPushError.statusCode === 404) {
      try {
        await prisma.pushSubscription.delete({ where: { endpoint } });
      } catch {
        // silent fail if already deleted
      }
    } else {
      // Log other errors but do not crash
      console.error("[WebPush] Failed to send push:", error);
    }
  }
}
