import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const sendSseBroadcastMock = jest.fn();
const sendSseToUserMock = jest.fn();
const sendWebPushMock = jest.fn();
const getUserSubscriptionsMock = jest.fn();

jest.unstable_mockModule("../../src/lib/sse-manager.js", () => ({
  sendSseBroadcast: sendSseBroadcastMock,
  sendSseToUser: sendSseToUserMock,
}));

jest.unstable_mockModule("../../src/lib/web-push.js", () => ({
  sendWebPush: sendWebPushMock,
}));

jest.unstable_mockModule("../../src/modules/push-subscriptions/push-subscriptions.service.js", () => ({
  getUserSubscriptions: getUserSubscriptionsMock,
}));

const { createNotification, notifyAdmins, notifyByRoles } = await import("../../src/lib/notify.js");

function mockNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: "notification-1",
    userId: "user-1",
    type: "SYSTEM",
    title: "Heads up",
    message: "Something happened",
    data: null,
    readAt: null,
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    ...overrides,
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    notification: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) =>
        mockNotification({ ...args.data, id: "notification-created" })
      ),
      createManyAndReturn: jest.fn(async (args: { data: Array<Record<string, unknown>> }) =>
        args.data.map((data, index) => mockNotification({ ...data, id: `notification-${index + 1}` }))
      ),
    },
    user: {
      findMany: jest.fn(async () => []),
    },
    pushSubscription: {
      findMany: jest.fn(async () => []),
    },
    ...overrides,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("notification helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendWebPushMock.mockResolvedValue(undefined as never);
    getUserSubscriptionsMock.mockResolvedValue([] as never);
  });

  it("creates a notification, sends SSE, and dispatches web push to the user subscriptions", async () => {
    const prisma = mockPrisma();
    getUserSubscriptionsMock.mockResolvedValue([
      { userId: "user-1", endpoint: "https://push.example.com/1", p256dh: "p256dh", auth: "auth" },
    ] as never);

    const result = await createNotification(prisma as never, {
      userId: "user-1",
      type: "QUESTION",
      title: "Question approved",
      message: "Your question is now available",
      data: { questionId: "question-1" },
    });
    await flushMicrotasks();

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "QUESTION",
        title: "Question approved",
        message: "Your question is now available",
        data: { questionId: "question-1" },
      },
    });
    expect(sendSseBroadcastMock).toHaveBeenCalledWith(["user-1"], "notification", result);
    expect(getUserSubscriptionsMock).toHaveBeenCalledWith(prisma, "user-1");
    expect(sendWebPushMock).toHaveBeenCalledWith(
      prisma,
      "https://push.example.com/1",
      "p256dh",
      "auth",
      result
    );
  });

  it("omits the data field when creating a notification without data", async () => {
    const prisma = mockPrisma();

    await createNotification(prisma as never, {
      userId: "user-1",
      type: "SYSTEM",
      title: "Plain",
      message: "No extra payload",
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "SYSTEM",
        title: "Plain",
        message: "No extra payload",
      },
    });
  });

  it("logs and continues when fetching a user's push subscriptions fails", async () => {
    const prisma = mockPrisma();
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("Redis unavailable");
    getUserSubscriptionsMock.mockRejectedValue(error as never);

    try {
      await createNotification(prisma as never, {
        userId: "user-1",
        type: "SYSTEM",
        title: "Heads up",
        message: "Something happened",
      });
      await flushMicrotasks();

      expect(consoleErrorSpy).toHaveBeenCalledWith("[WebPush] Failed to fetch subscriptions", error);
      expect(sendWebPushMock).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns an empty list when there are no active admins", async () => {
    const prisma = mockPrisma();

    const result = await notifyAdmins(prisma as never, {
      type: "SYSTEM",
      title: "Admin notice",
      message: "Nothing to send",
    });

    expect(result).toEqual([]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true },
    });
    expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("notifies admins through database rows, SSE, and matching web push subscriptions", async () => {
    const prisma = mockPrisma({
      user: {
        findMany: jest.fn(async () => [{ id: "admin-1" }, { id: "admin-2" }]),
      },
      pushSubscription: {
        findMany: jest.fn(async () => [
          { userId: "admin-2", endpoint: "https://push.example.com/admin-2", p256dh: "p256dh-2", auth: "auth-2" },
        ]),
      },
    });

    const result = await notifyAdmins(prisma as never, {
      type: "IMPORT",
      title: "Import finished",
      message: "A tutor imported questions",
      data: { importId: "import-1" },
    });
    await flushMicrotasks();

    expect(prisma.notification.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        {
          userId: "admin-1",
          type: "IMPORT",
          title: "Import finished",
          message: "A tutor imported questions",
          data: { importId: "import-1" },
        },
        {
          userId: "admin-2",
          type: "IMPORT",
          title: "Import finished",
          message: "A tutor imported questions",
          data: { importId: "import-1" },
        },
      ],
    });
    expect(sendSseToUserMock).toHaveBeenCalledWith("admin-1", "notification", result[0]);
    expect(sendSseToUserMock).toHaveBeenCalledWith("admin-2", "notification", result[1]);
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
      where: { userId: { in: ["admin-1", "admin-2"] } },
      select: { userId: true, endpoint: true, p256dh: true, auth: true },
    });
    expect(sendWebPushMock).toHaveBeenCalledTimes(1);
    expect(sendWebPushMock).toHaveBeenCalledWith(
      prisma,
      "https://push.example.com/admin-2",
      "p256dh-2",
      "auth-2",
      result[1]
    );
  });

  it("logs and continues when fetching admin push subscriptions fails", async () => {
    const error = new Error("Subscription store unavailable");
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const prisma = mockPrisma({
      user: {
        findMany: jest.fn(async () => [{ id: "admin-1" }]),
      },
      pushSubscription: {
        findMany: jest.fn(async () => {
          throw error;
        }),
      },
    });

    try {
      const result = await notifyAdmins(prisma as never, {
        type: "SYSTEM",
        title: "Admin notice",
        message: "Push lookup can fail",
      });
      await flushMicrotasks();

      expect(result).toHaveLength(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith("[WebPush] Failed to fetch admin subscriptions", error);
      expect(sendWebPushMock).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("notifies users by role and omits data when none is provided", async () => {
    const prisma = mockPrisma({
      user: {
        findMany: jest.fn(async () => [{ id: "student-1" }]),
      },
      pushSubscription: {
        findMany: jest.fn(async () => [
          { userId: "student-1", endpoint: "https://push.example.com/student-1", p256dh: "p256dh", auth: "auth" },
        ]),
      },
    });

    const result = await notifyByRoles(prisma as never, ["STUDENT"], {
      type: "ANNOUNCEMENT",
      title: "New announcement",
      message: "Read the latest update",
    });
    await flushMicrotasks();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: { in: ["STUDENT"] }, status: "ACTIVE" },
      select: { id: true },
    });
    expect(prisma.notification.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        {
          userId: "student-1",
          type: "ANNOUNCEMENT",
          title: "New announcement",
          message: "Read the latest update",
        },
      ],
    });
    expect(sendSseToUserMock).toHaveBeenCalledWith("student-1", "notification", result[0]);
    expect(sendWebPushMock).toHaveBeenCalledWith(
      prisma,
      "https://push.example.com/student-1",
      "p256dh",
      "auth",
      result[0]
    );
  });

  it("logs and continues when fetching role push subscriptions fails", async () => {
    const error = new Error("Subscription lookup failed");
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const prisma = mockPrisma({
      user: {
        findMany: jest.fn(async () => [{ id: "student-1" }]),
      },
      pushSubscription: {
        findMany: jest.fn(async () => {
          throw error;
        }),
      },
    });

    try {
      const result = await notifyByRoles(prisma as never, ["STUDENT"], {
        type: "ANNOUNCEMENT",
        title: "New announcement",
        message: "Push lookup can fail",
      });
      await flushMicrotasks();

      expect(result).toHaveLength(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith("[WebPush] Failed to fetch role subscriptions", error);
      expect(sendWebPushMock).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns an empty list when no users match the requested roles", async () => {
    const prisma = mockPrisma();

    const result = await notifyByRoles(prisma as never, ["PARENT"], {
      type: "ANNOUNCEMENT",
      title: "No recipients",
      message: "No one should receive this",
    });

    expect(result).toEqual([]);
    expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    expect(sendSseToUserMock).not.toHaveBeenCalled();
  });
});
