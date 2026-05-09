import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const addSseClientMock = jest.fn();
const removeSseClientMock = jest.fn();

jest.unstable_mockModule("../../src/lib/sse-manager.js", () => ({
  addSseClient: addSseClientMock,
  removeSseClient: removeSseClientMock,
}));

const {
  getUnreadCount,
  listNotifications,
  markAllAsRead,
  markAsRead,
} = await import("../../src/modules/notifications/notifications.service.js");
const notificationsController = await import("../../src/modules/notifications/notifications.controller.js");

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: "notification-1",
    userId: "user-1",
    type: "SYSTEM",
    title: "Notice",
    message: "Message",
    data: null,
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    ...overrides,
  };
}

function mockPrisma() {
  return {
    notification: {
      findMany: jest.fn(async () => [notification()]),
      count: jest.fn(async () => 1),
      updateMany: jest.fn(async () => ({ count: 1 })),
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

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    query: { page: 1, limit: 20 },
    params: {},
    user: { sub: "user-1" },
    server: { prisma: mockPrisma() },
    raw: { on: jest.fn() },
    ...overrides,
  };
}

describe("notifications module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("lists notifications with pagination metadata", async () => {
    const prisma = mockPrisma();

    const result = await listNotifications(prisma as never, "user-1", {
      page: 2,
      limit: 10,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
      skip: 10,
      take: 10,
    });
    expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(result).toEqual({
      data: [notification()],
      meta: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it("filters unread notifications when requested", async () => {
    const prisma = mockPrisma();

    await listNotifications(prisma as never, "user-1", {
      page: 1,
      limit: 20,
      unreadOnly: true,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", isRead: false },
      })
    );
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: "user-1", isRead: false },
    });
  });

  it("counts unread notifications for a user", async () => {
    const prisma = mockPrisma();

    await expect(getUnreadCount(prisma as never, "user-1")).resolves.toBe(1);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: "user-1", isRead: false },
    });
  });

  it("marks one notification as read only for the owning user", async () => {
    const prisma = mockPrisma();

    await markAsRead(prisma as never, "user-1", "notification-1");

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "notification-1", userId: "user-1" },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });

  it("marks all unread notifications as read and returns the updated count", async () => {
    const prisma = mockPrisma();

    await expect(markAllAsRead(prisma as never, "user-1")).resolves.toBe(1);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });

  it("sends list notifications response from the controller", async () => {
    const request = mockRequest({ query: { page: 1, limit: 20 } });
    const reply = mockReply();

    const response = await notificationsController.listNotificationsHandler(request as never, reply as never);

    expect(response).toMatchObject({
      success: true,
      message: "Notifications retrieved",
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it("sends unread count response from the controller", async () => {
    const request = mockRequest();
    const reply = mockReply();

    const response = await notificationsController.unreadCountHandler(request as never, reply as never);

    expect(response).toEqual({ success: true, count: 1 });
  });

  it("marks a notification as read from the controller", async () => {
    const request = mockRequest({ params: { id: "notification-1" } });
    const reply = mockReply();

    const response = await notificationsController.markAsReadHandler(request as never, reply as never);

    expect(request.server.prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "notification-1", userId: "user-1" },
      })
    );
    expect(response).toEqual({ success: true, message: "Notification marked as read" });
  });

  it("marks all notifications as read from the controller", async () => {
    const request = mockRequest();
    const reply = mockReply();

    const response = await notificationsController.markAllAsReadHandler(request as never, reply as never);

    expect(response).toEqual({
      success: true,
      message: "1 notification(s) marked as read",
      count: 1,
    });
  });

  it("registers an SSE client and cleans it up on close", async () => {
    jest.useFakeTimers();
    const closeHandlers: Array<() => void> = [];
    const request = mockRequest({
      raw: {
        on: jest.fn((event: string, handler: () => void) => {
          if (event === "close") closeHandlers.push(handler);
        }),
      },
    });
    const reply = {
      hijack: jest.fn(),
      raw: {
        writeHead: jest.fn(),
        write: jest.fn(),
      },
    };

    await notificationsController.sseHandler(request as never, reply as never);
    jest.advanceTimersByTime(30_000);
    for (const handler of closeHandlers) handler();

    expect(reply.hijack).toHaveBeenCalled();
    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    expect(reply.raw.write).toHaveBeenCalledWith(
      `event: connected\ndata: ${JSON.stringify({ userId: "user-1" })}\n\n`
    );
    expect(reply.raw.write).toHaveBeenCalledWith(": keep-alive\n\n");
    expect(addSseClientMock).toHaveBeenCalledWith("user-1", reply);
    expect(removeSseClientMock).toHaveBeenCalledWith("user-1", reply);
  });

  it("clears the keep-alive interval when writing to the SSE stream fails", async () => {
    jest.useFakeTimers();
    const request = mockRequest();
    const reply = {
      hijack: jest.fn(),
      raw: {
        writeHead: jest.fn(),
        write: jest
          .fn()
          .mockImplementationOnce(() => true)
          .mockImplementationOnce(() => {
            throw new Error("client disconnected");
          }),
      },
    };

    await notificationsController.sseHandler(request as never, reply as never);
    jest.advanceTimersByTime(30_000);
    jest.advanceTimersByTime(30_000);

    expect(reply.raw.write).toHaveBeenCalledTimes(2);
  });
});
