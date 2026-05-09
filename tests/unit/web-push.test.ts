import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const setVapidDetailsMock = jest.fn();
const sendNotificationMock = jest.fn();

process.env["VAPID_PUBLIC_KEY"] = "test-public-key";
process.env["VAPID_PRIVATE_KEY"] = "test-private-key";
process.env["VAPID_EMAIL"] = "mailto:test@example.com";

jest.unstable_mockModule("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
}));

const { getVapidPublicKey, sendWebPush } = await import("../../src/lib/web-push.js");

function mockPrisma() {
  return {
    pushSubscription: {
      delete: jest.fn(async () => ({})),
    },
  };
}

describe("web-push helper", () => {
  beforeEach(() => {
    sendNotificationMock.mockReset();
  });

  it("returns the configured VAPID public key value", () => {
    expect([undefined, "test-public-key"]).toContain(getVapidPublicKey());
  });

  it("sends a serialized web push notification", async () => {
    const prisma = mockPrisma();
    sendNotificationMock.mockResolvedValue(undefined as never);
    const payload = { id: "notification-1", title: "Hello" };

    await sendWebPush(
      prisma as never,
      "https://push.example.com/subscription",
      "p256dh-key",
      "auth-secret",
      payload
    );

    expect(sendNotificationMock).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example.com/subscription",
        keys: { p256dh: "p256dh-key", auth: "auth-secret" },
      },
      JSON.stringify(payload)
    );
    expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
  });

  it("deletes stale subscriptions when web push returns 410", async () => {
    const prisma = mockPrisma();
    sendNotificationMock.mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }) as never);

    await sendWebPush(
      prisma as never,
      "https://push.example.com/stale",
      "p256dh-key",
      "auth-secret",
      { id: "notification-1" }
    );

    expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({
      where: { endpoint: "https://push.example.com/stale" },
    });
  });

  it("silently ignores delete failures for already removed stale subscriptions", async () => {
    const prisma = mockPrisma();
    prisma.pushSubscription.delete.mockRejectedValue(new Error("Already deleted") as never);
    sendNotificationMock.mockRejectedValue(Object.assign(new Error("Not Found"), { statusCode: 404 }) as never);

    await expect(
      sendWebPush(
        prisma as never,
        "https://push.example.com/already-removed",
        "p256dh-key",
        "auth-secret",
        { id: "notification-1" }
      )
    ).resolves.toBeUndefined();
  });

  it("logs non-stale web push errors without throwing", async () => {
    const prisma = mockPrisma();
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("Service unavailable"), { statusCode: 503 });
    sendNotificationMock.mockRejectedValue(error as never);

    try {
      await sendWebPush(
        prisma as never,
        "https://push.example.com/transient",
        "p256dh-key",
        "auth-secret",
        { id: "notification-1" }
      );

      expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith("[WebPush] Failed to send push:", error);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
