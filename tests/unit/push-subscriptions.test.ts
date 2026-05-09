import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const getVapidPublicKeyMock = jest.fn();

jest.unstable_mockModule("../../src/lib/web-push.js", () => ({
  getVapidPublicKey: getVapidPublicKeyMock,
}));

const {
  deleteSubscription,
  getUserSubscriptions,
  saveSubscription,
} = await import("../../src/modules/push-subscriptions/push-subscriptions.service.js");
const {
  getVapidKeyHandler,
  subscribeHandler,
  unsubscribeHandler,
} = await import("../../src/modules/push-subscriptions/push-subscriptions.controller.js");

function subscribeBody(overrides: Record<string, unknown> = {}) {
  return {
    subscription: {
      endpoint: "https://push.example.com/subscription-1",
      keys: {
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
    },
    userAgent: "Chrome",
    ...overrides,
  };
}

function mockPrisma() {
  return {
    pushSubscription: {
      upsert: jest.fn(async () => undefined),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };
}

function mockReply() {
  const reply = {
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

describe("push subscriptions module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getVapidPublicKeyMock.mockReturnValue("public-vapid-key");
  });

  it("upserts a push subscription for the current user", async () => {
    const prisma = mockPrisma();

    await saveSubscription(prisma as never, "user-1", subscribeBody());

    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: "https://push.example.com/subscription-1" },
      update: {
        userId: "user-1",
        p256dh: "p256dh-key",
        auth: "auth-key",
        userAgent: "Chrome",
      },
      create: {
        userId: "user-1",
        endpoint: "https://push.example.com/subscription-1",
        p256dh: "p256dh-key",
        auth: "auth-key",
        userAgent: "Chrome",
      },
    });
  });

  it("stores null user agent when the browser does not provide one", async () => {
    const prisma = mockPrisma();

    await saveSubscription(prisma as never, "user-1", subscribeBody({ userAgent: undefined }));

    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ userAgent: null }),
        create: expect.objectContaining({ userAgent: null }),
      })
    );
  });

  it("fetches user subscriptions newest first", async () => {
    const prisma = mockPrisma();

    await getUserSubscriptions(prisma as never, "user-1");

    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("deletes a subscription only for the owning user and endpoint", async () => {
    const prisma = mockPrisma();

    await deleteSubscription(prisma as never, "user-1", "https://push.example.com/subscription-1");

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", endpoint: "https://push.example.com/subscription-1" },
    });
  });

  it("returns the configured VAPID public key", async () => {
    const reply = mockReply();

    const response = await getVapidKeyHandler({} as never, reply as never);

    expect(response).toEqual({ success: true, publicKey: "public-vapid-key" });
  });

  it("returns null when the VAPID public key is not configured", async () => {
    getVapidPublicKeyMock.mockReturnValue(undefined);
    const reply = mockReply();

    const response = await getVapidKeyHandler({} as never, reply as never);

    expect(response).toEqual({ success: true, publicKey: null });
  });

  it("subscribes the authenticated user", async () => {
    const request = {
      body: subscribeBody(),
      user: { sub: "user-1" },
      server: { prisma: mockPrisma() },
    };
    const reply = mockReply();

    const response = await subscribeHandler(request as never, reply as never);

    expect(request.server.prisma.pushSubscription.upsert).toHaveBeenCalled();
    expect(response).toEqual({ success: true, message: "Subscribed successfully" });
  });

  it("unsubscribes the authenticated user", async () => {
    const request = {
      body: { endpoint: "https://push.example.com/subscription-1" },
      user: { sub: "user-1" },
      server: { prisma: mockPrisma() },
    };
    const reply = mockReply();

    const response = await unsubscribeHandler(request as never, reply as never);

    expect(request.server.prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", endpoint: "https://push.example.com/subscription-1" },
    });
    expect(response).toEqual({ success: true, message: "Unsubscribed successfully" });
  });
});
