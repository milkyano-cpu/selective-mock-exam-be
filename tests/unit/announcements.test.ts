import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const notifyByRolesMock = jest.fn();
const decryptFieldMock = jest.fn((value: string) => `decrypted:${value}`);
const queueAddMock = jest.fn();
const getQueueMock = jest.fn(() => ({ add: queueAddMock }));
const workerOnMock = jest.fn();
const workerMock = jest.fn().mockImplementation((_name, processor, options) => ({
  processor,
  options,
  on: workerOnMock,
}));

jest.unstable_mockModule("../../src/lib/notify.js", () => ({
  notifyByRoles: notifyByRolesMock,
}));

jest.unstable_mockModule("../../src/utils/field-encryption.js", () => ({
  decryptField: decryptFieldMock,
}));

jest.unstable_mockModule("../../src/lib/queue.js", () => ({
  getQueue: getQueueMock,
}));

jest.unstable_mockModule("bullmq", () => ({
  Worker: workerMock,
}));

const {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  listAnnouncementsFeed,
  sendAnnouncement,
} = await import("../../src/modules/announcements/announcements.service.js");
const announcementsController = await import("../../src/modules/announcements/announcements.controller.js");
const { createBroadcastWorker } = await import("../../src/modules/announcements/announcements.worker.js");

const now = new Date("2026-05-08T00:00:00.000Z");

function announcement(overrides: Record<string, unknown> = {}) {
  return {
    id: "announcement-1",
    authorId: "admin-1",
    title: "Exam update",
    message: "New practice set is available",
    priority: "NORMAL",
    target: ["STUDENT"],
    status: "SCHEDULED",
    scheduledAt: null,
    sentAt: null,
    createdAt: now,
    author: { fullName: "encrypted-admin-name" },
    ...overrides,
  };
}

function serialized(overrides: Record<string, unknown> = {}) {
  return {
    id: "announcement-1",
    authorId: "admin-1",
    title: "Exam update",
    message: "New practice set is available",
    priority: "NORMAL",
    target: ["STUDENT"],
    status: "SCHEDULED",
    scheduledAt: null,
    sentAt: null,
    createdAt: now.toISOString(),
    authorName: "decrypted:encrypted-admin-name",
    ...overrides,
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    announcement: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) =>
        announcement(args.data)
      ),
      findUnique: jest.fn(async () => announcement()),
      update: jest.fn(async (args: { data: Record<string, unknown> }) =>
        announcement({ ...args.data, status: "SENT", sentAt: new Date("2026-05-08T01:00:00.000Z") })
      ),
      findMany: jest.fn(async () => [announcement()]),
      count: jest.fn(async () => 1),
      delete: jest.fn(async () => announcement()),
    },
    ...overrides,
  };
}

function mockReply() {
  const reply = {
    code: jest.fn<(code: number) => typeof reply>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.code.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      title: "Exam update",
      message: "New practice set is available",
      priority: "NORMAL",
      target: ["STUDENT"],
    },
    query: { page: 1, limit: 20 },
    params: { id: "announcement-1" },
    user: { sub: "admin-1", role: "STUDENT" },
    server: { prisma: mockPrisma(), redis: {} },
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...overrides,
  };
}

describe("announcements module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    notifyByRolesMock.mockResolvedValue([] as never);
    decryptFieldMock.mockImplementation((value: string) => `decrypted:${value}`);
  });

  it("creates an immediate announcement and marks it unscheduled", async () => {
    const prisma = mockPrisma();

    const result = await createAnnouncement(prisma as never, "admin-1", {
      title: "Exam update",
      message: "New practice set is available",
      priority: "NORMAL",
      target: ["STUDENT"],
    });

    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: {
        authorId: "admin-1",
        title: "Exam update",
        message: "New practice set is available",
        priority: "NORMAL",
        target: ["STUDENT"],
        status: "SCHEDULED",
        scheduledAt: null,
        sentAt: null,
      },
      select: expect.any(Object),
    });
    expect(result).toEqual({
      announcement: serialized(),
      isScheduled: false,
    });
  });

  it("creates a future scheduled announcement", async () => {
    jest.useFakeTimers().setSystemTime(now);
    const scheduledAt = "2026-05-08T02:00:00.000Z";
    const prisma = mockPrisma();

    const result = await createAnnouncement(prisma as never, "admin-1", {
      title: "Later",
      message: "Scheduled message",
      priority: "URGENT",
      target: ["PARENT"],
      scheduledAt,
    });

    expect(prisma.announcement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduledAt: new Date(scheduledAt),
        }),
      })
    );
    expect(result.isScheduled).toBe(true);
  });

  it("returns null when sending a missing announcement", async () => {
    const prisma = mockPrisma({
      announcement: {
        ...mockPrisma().announcement,
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(sendAnnouncement(prisma as never, "missing")).resolves.toBeNull();
    expect(notifyByRolesMock).not.toHaveBeenCalled();
  });

  it("returns already sent announcements without notifying again", async () => {
    const sentAt = new Date("2026-05-08T01:00:00.000Z");
    const prisma = mockPrisma({
      announcement: {
        ...mockPrisma().announcement,
        findUnique: jest.fn(async () => announcement({ status: "SENT", sentAt })),
      },
    });

    const result = await sendAnnouncement(prisma as never, "announcement-1");

    expect(result).toEqual(serialized({ status: "SENT", sentAt: sentAt.toISOString() }));
    expect(notifyByRolesMock).not.toHaveBeenCalled();
  });

  it("sends an announcement to target roles and marks it sent", async () => {
    const prisma = mockPrisma();

    const result = await sendAnnouncement(prisma as never, "announcement-1");

    expect(notifyByRolesMock).toHaveBeenCalledWith(prisma, ["STUDENT"], {
      type: "ANNOUNCEMENT",
      title: "Exam update",
      message: "New practice set is available",
      data: { announcementId: "announcement-1", priority: "NORMAL" },
    });
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: "announcement-1" },
      data: { status: "SENT", sentAt: expect.any(Date) },
      select: expect.any(Object),
    });
    expect(result).toMatchObject({ status: "SENT", sentAt: "2026-05-08T01:00:00.000Z" });
  });

  it("lists announcements for admin views", async () => {
    const prisma = mockPrisma();

    const result = await listAnnouncements(prisma as never, { page: 2, limit: 10 });

    expect(prisma.announcement.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      skip: 10,
      take: 10,
      select: expect.any(Object),
    });
    expect(result).toEqual({
      data: [serialized()],
      meta: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it("lists sent announcements for a role feed", async () => {
    const prisma = mockPrisma();

    await listAnnouncementsFeed(prisma as never, "STUDENT", { page: 1, limit: 20 });

    expect(prisma.announcement.findMany).toHaveBeenCalledWith({
      where: { status: "SENT", target: { has: "STUDENT" } },
      orderBy: { sentAt: "desc" },
      skip: 0,
      take: 20,
      select: expect.any(Object),
    });
    expect(prisma.announcement.count).toHaveBeenCalledWith({
      where: { status: "SENT", target: { has: "STUDENT" } },
    });
  });

  it("deletes an announcement by id", async () => {
    const prisma = mockPrisma();

    await deleteAnnouncement(prisma as never, "announcement-1");

    expect(prisma.announcement.delete).toHaveBeenCalledWith({ where: { id: "announcement-1" } });
  });

  it("schedules future announcements from the controller", async () => {
    jest.useFakeTimers().setSystemTime(now);
    const scheduledAt = "2026-05-08T00:05:00.000Z";
    const request = mockRequest({
      body: {
        title: "Later",
        message: "Scheduled message",
        priority: "NORMAL",
        target: ["STUDENT"],
        scheduledAt,
      },
    });
    const reply = mockReply();

    const response = await announcementsController.createAnnouncementHandler(request as never, reply as never);

    expect(getQueueMock).toHaveBeenCalledWith("broadcast", request.server.redis);
    expect(queueAddMock).toHaveBeenCalledWith(
      "send-announcement",
      { announcementId: "announcement-1" },
      { delay: 300_000, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );
    expect(request.log.info).toHaveBeenCalledWith(
      { announcementId: "announcement-1", delay: 300_000 },
      "Announcement scheduled"
    );
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(response).toMatchObject({ success: true, message: "Announcement scheduled successfully" });
  });

  it("sends immediate announcements from the controller", async () => {
    const request = mockRequest();
    const reply = mockReply();

    const response = await announcementsController.createAnnouncementHandler(request as never, reply as never);

    expect(notifyByRolesMock).toHaveBeenCalled();
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(response).toMatchObject({ success: true, message: "Announcement sent successfully" });
  });

  it("falls back to the created announcement when immediate send returns null", async () => {
    const request = mockRequest({
      server: {
        prisma: mockPrisma({
          announcement: {
            ...mockPrisma().announcement,
            findUnique: jest.fn(async () => null),
          },
        }),
        redis: {},
      },
    });
    const reply = mockReply();

    const response = await announcementsController.createAnnouncementHandler(request as never, reply as never);

    expect(response).toMatchObject({
      success: true,
      message: "Announcement sent successfully",
      data: serialized(),
    });
  });

  it("lists admin announcements and role feed from the controller", async () => {
    const request = mockRequest({ query: { page: 1, limit: 20 } });
    const reply = mockReply();

    const adminResponse = await announcementsController.listAnnouncementsHandler(request as never, reply as never);
    const feedResponse = await announcementsController.announcementsFeedHandler(request as never, reply as never);

    expect(adminResponse).toMatchObject({ success: true, message: "Announcements retrieved" });
    expect(feedResponse).toMatchObject({ success: true, message: "Announcements feed retrieved" });
  });

  it("deletes announcements from the controller", async () => {
    const request = mockRequest();
    const reply = mockReply();

    const response = await announcementsController.deleteAnnouncementHandler(request as never, reply as never);

    expect(request.server.prisma.announcement.delete).toHaveBeenCalledWith({
      where: { id: "announcement-1" },
    });
    expect(response).toEqual({ success: true, message: "Announcement deleted" });
  });

  it("creates a broadcast worker and logs failed and completed jobs", async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = createBroadcastWorker({} as never, mockPrisma() as never, logger as never) as unknown as {
      processor: (job: { id: string; data: { announcementId: string } }) => Promise<void>;
      options: Record<string, unknown>;
    };

    await worker.processor({ id: "job-1", data: { announcementId: "announcement-1" } });
    const failedHandler = workerOnMock.mock.calls.find((call) => call[0] === "failed")?.[1] as (
      job: { id: string; data: { announcementId: string } } | undefined,
      err: Error
    ) => void;
    const completedHandler = workerOnMock.mock.calls.find((call) => call[0] === "completed")?.[1] as (
      job: { id: string; data: { announcementId: string } }
    ) => void;
    const error = new Error("boom");
    failedHandler({ id: "job-2", data: { announcementId: "announcement-2" } }, error);
    completedHandler({ id: "job-3", data: { announcementId: "announcement-3" } });

    expect(workerMock).toHaveBeenCalledWith("broadcast", expect.any(Function), {
      connection: {},
      concurrency: 5,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { announcementId: "announcement-1", jobId: "job-1" },
      "Processing scheduled broadcast"
    );
    expect(logger.error).toHaveBeenCalledWith(
      { jobId: "job-2", announcementId: "announcement-2", err: error },
      "Broadcast job failed"
    );
    expect(logger.info).toHaveBeenCalledWith(
      { jobId: "job-3", announcementId: "announcement-3" },
      "Broadcast job completed"
    );
  });

  it("logs a warning when a scheduled broadcast cannot find the announcement", async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const prisma = mockPrisma({
      announcement: {
        ...mockPrisma().announcement,
        findUnique: jest.fn(async () => null),
      },
    });
    const worker = createBroadcastWorker({} as never, prisma as never, logger as never) as unknown as {
      processor: (job: { id: string; data: { announcementId: string } }) => Promise<void>;
    };

    await worker.processor({ id: "job-1", data: { announcementId: "missing-announcement" } });

    expect(logger.warn).toHaveBeenCalledWith(
      { announcementId: "missing-announcement" },
      "Announcement not found or already sent"
    );
  });
});
