import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const createNotificationMock = jest.fn();

jest.unstable_mockModule("../../src/lib/notify.js", () => ({
  createNotification: createNotificationMock,
}));

const forum = await import("../../src/modules/forum/forum.service.js");
const { encryptField } = await import("../../src/utils/field-encryption.js");

const now = new Date("2026-05-08T00:00:00.000Z");
const later = new Date("2026-05-08T01:00:00.000Z");

function author(id = "student-1", name = "Ryan Lee") {
  return { id, fullName: encryptField(name) };
}

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread-1",
    segment: "STUDENT",
    title: "How do analogies work?",
    authorId: "student-1",
    author: author(),
    isPinned: false,
    isLocked: false,
    createdAt: now,
    updatedAt: later,
    _count: { posts: 2 },
    posts: [{ createdAt: later, isAnonymous: false, authorId: "student-2" }],
    ...overrides,
  };
}

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    threadId: "thread-1",
    authorId: "student-2",
    author: author("student-2", "Zoe White"),
    content: "Try comparing the relationship first.",
    isAnonymous: false,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    _count: { flags: 0 },
    ...overrides,
  };
}

function flag(overrides: Record<string, unknown> = {}) {
  return {
    id: "flag-1",
    postId: "post-1",
    reason: "SPAM",
    note: "Looks suspicious",
    status: "PENDING",
    createdAt: now,
    post: { content: "Flagged content" },
    reporter: author("student-3", "Emma Garcia"),
    ...overrides,
  };
}

function warning(overrides: Record<string, unknown> = {}) {
  return {
    id: "warning-1",
    level: "WARN",
    reason: "Keep it respectful",
    createdAt: now,
    user: author("student-1", "Ryan Lee"),
    admin: author("admin-1", "Admin User"),
    ...overrides,
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn(async () => ({ id: "student-1", status: "ACTIVE" })),
      update: jest.fn(async () => ({ id: "student-1" })),
    },
    forumBannedWord: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: "word-1", word: "spoiler", createdAt: now })),
      delete: jest.fn(async () => undefined),
    },
    forumThread: {
      findMany: jest.fn(async () => [thread()]),
      count: jest.fn(async () => 1),
      create: jest.fn(async () => thread({ _count: undefined, posts: undefined })),
      findUnique: jest.fn(async () => thread()),
      update: jest.fn(async () => thread()),
      delete: jest.fn(async () => thread()),
    },
    forumPost: {
      findMany: jest.fn(async () => [
        post(),
        post({ id: "post-2", isAnonymous: true, authorId: "student-1", author: author("student-1", "Ryan Lee") }),
      ]),
      count: jest.fn(async () => 2),
      create: jest.fn(async () => post()),
      findUnique: jest.fn(async () => post()),
      update: jest.fn(async () => post()),
      delete: jest.fn(async () => post()),
    },
    forumFlag: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => flag()),
      findMany: jest.fn(async () => [flag()]),
      count: jest.fn(async () => 1),
      update: jest.fn(async () => flag({ status: "APPROVED" })),
    },
    forumWarning: {
      create: jest.fn(async () => warning()),
      findMany: jest.fn(async () => [warning()]),
      count: jest.fn(async () => 1),
    },
    ...overrides,
  };
}

describe("forum service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createNotificationMock.mockResolvedValue(undefined as never);
  });

  it("lists threads with access checks, pagination, masked author data, and active post count", async () => {
    const prisma = mockPrisma();

    const result = await forum.listThreads(
      prisma as never,
      { segment: "STUDENT", page: 1, limit: 10 },
      "student-2",
      "STUDENT"
    );

    expect(prisma.forumThread.findMany).toHaveBeenCalledWith({
      where: { segment: "STUDENT", posts: { some: { status: "ACTIVE" } } },
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
      skip: 0,
      take: 10,
      select: expect.any(Object),
    });
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: "thread-1",
          author: { id: "student-1", name: "Ryan Lee" },
          postCount: 1,
          lastPostAt: later.toISOString(),
          status: "ACTIVE",
        }),
      ],
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });

    await expect(
      forum.listThreads(prisma as never, { segment: "PARENT", page: 1, limit: 10 }, "student-1", "STUDENT")
    ).rejects.toMatchObject({ statusCode: 403, message: "Forbidden" });
  });

  it("creates threads and puts banned content under review", async () => {
    const prisma = mockPrisma({
      forumBannedWord: { ...mockPrisma().forumBannedWord, findMany: jest.fn(async () => [{ word: "banned" }]) },
    });

    const result = await forum.createThread(prisma as never, "student-1", "STUDENT", "STUDENT", {
      title: " A banned topic ",
      content: " Please review this banned content ",
      isAnonymous: true,
    });

    expect(prisma.forumThread.create).toHaveBeenCalledWith({
      data: {
        authorId: "student-1",
        segment: "STUDENT",
        title: "A banned topic",
        posts: {
          create: {
            authorId: "student-1",
            content: "Please review this banned content",
            isAnonymous: true,
            status: "UNDER_REVIEW",
          },
        },
      },
      select: expect.any(Object),
    });
    expect(result).toMatchObject({
      author: { id: "student-1", name: "Anonymous (You)" },
      status: "UNDER_REVIEW",
      underReview: true,
    });

    const suspended = mockPrisma({ user: { ...mockPrisma().user, findUnique: jest.fn(async () => ({ status: "SUSPENDED" })) } });
    await expect(
      forum.createThread(suspended as never, "student-1", "STUDENT", "STUDENT", {
        title: "Topic",
        content: "Content",
        isAnonymous: false,
      })
    ).rejects.toMatchObject({ statusCode: 403, message: "Your account has been suspended from posting" });
  });

  it("gets thread posts and creates replies with notification for thread owner", async () => {
    const prisma = mockPrisma({
      forumThread: {
        ...mockPrisma().forumThread,
        findUnique: jest.fn(async () => thread({ authorId: "student-1", title: "Analogy help" })),
      },
    });

    const detail = await forum.getThread(
      prisma as never,
      "thread-1",
      { page: 1, limit: 10 },
      "student-1",
      "STUDENT"
    );

    expect(detail.posts).toEqual([
      expect.objectContaining({ author: { id: "student-2", name: "Zoe White" } }),
      expect.objectContaining({ author: { id: "student-1", name: "Anonymous (You)" } }),
    ]);

    const reply = await forum.createPost(prisma as never, "thread-1", "student-2", "STUDENT", {
      content: " New reply ",
      isAnonymous: false,
    });

    expect(prisma.forumPost.create).toHaveBeenCalledWith({
      data: {
        threadId: "thread-1",
        authorId: "student-2",
        content: "New reply",
        isAnonymous: false,
        status: "ACTIVE",
      },
      select: expect.any(Object),
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: "student-1",
        type: "FORUM_REPLY",
        data: { threadId: "thread-1", postId: "post-1" },
      })
    );
    expect(reply).toMatchObject({ id: "post-1", underReview: false });

    const locked = mockPrisma({
      forumThread: { ...mockPrisma().forumThread, findUnique: jest.fn(async () => ({ ...thread(), isLocked: true })) },
    });
    await expect(
      forum.createPost(locked as never, "thread-1", "student-2", "STUDENT", { content: "Reply", isAnonymous: false })
    ).rejects.toMatchObject({ statusCode: 403, message: "This thread has been locked" });
  });

  it("deletes posts only for owners/admins and flags posts once", async () => {
    const prisma = mockPrisma();

    await forum.deletePost(prisma as never, "post-1", "student-2", "STUDENT");
    await forum.deletePost(prisma as never, "post-1", "admin-1", "ADMIN");
    expect(prisma.forumPost.delete).toHaveBeenCalledWith({ where: { id: "post-1" } });

    await forum.flagPost(prisma as never, "post-1", "student-3", { reason: "SPAM", note: undefined });
    expect(prisma.forumFlag.create).toHaveBeenCalledWith({
      data: { postId: "post-1", reporterId: "student-3", reason: "SPAM", note: null },
    });
    expect(prisma.forumPost.update).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: { status: "UNDER_REVIEW" },
    });

    await expect(forum.deletePost(prisma as never, "post-1", "student-1", "STUDENT")).rejects.toMatchObject({
      statusCode: 403,
      message: "You are not allowed to delete this post",
    });
    await expect(forum.flagPost(prisma as never, "post-1", "student-2", { reason: "OTHER" })).rejects.toMatchObject({
      statusCode: 400,
      message: "You cannot flag your own post",
    });
  });

  it("lists and reviews flags, restoring or rejecting posts", async () => {
    const prisma = mockPrisma({
      forumFlag: {
        ...mockPrisma().forumFlag,
        findUnique: jest.fn(async () => ({ postId: "post-1", status: "PENDING" })),
      },
    });

    const flags = await forum.adminListFlags(prisma as never, { status: "PENDING", page: 1, limit: 10 });
    expect(flags.data[0]).toMatchObject({
      id: "flag-1",
      postContent: "Flagged content",
      reporter: { id: "student-3", name: "Emma Garcia" },
      note: "Looks suspicious",
    });

    await forum.adminReviewFlag(prisma as never, "flag-1", "admin-1", { action: "REJECT" });
    expect(prisma.forumFlag.update).toHaveBeenCalledWith({
      where: { id: "flag-1" },
      data: { status: "REJECTED", reviewedBy: "admin-1", reviewedAt: expect.any(Date) },
    });
    expect(prisma.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "ACTIVE" } });

    await forum.adminReviewFlag(prisma as never, "flag-1", "admin-1", { action: "APPROVE" });
    expect(prisma.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "REJECTED" } });

    const reviewed = mockPrisma({
      forumFlag: { ...mockPrisma().forumFlag, findUnique: jest.fn(async () => ({ postId: "post-1", status: "APPROVED" })) },
    });
    await expect(forum.adminReviewFlag(reviewed as never, "flag-1", "admin-1", { action: "APPROVE" })).rejects.toMatchObject({
      statusCode: 409,
      message: "Flag already reviewed",
    });
  });

  it("creates warnings, lists warnings, and applies suspend level", async () => {
    const prisma = mockPrisma();

    await forum.adminWarnUser(prisma as never, "student-1", "admin-1", {
      level: "SUSPEND",
      reason: "Repeated spam",
    });
    expect(prisma.forumWarning.create).toHaveBeenCalledWith({
      data: { userId: "student-1", adminId: "admin-1", level: "SUSPEND", reason: "Repeated spam" },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "student-1" }, data: { status: "SUSPENDED" } });

    const warnings = await forum.adminListWarnings(prisma as never, { userId: "student-1", page: 1, limit: 10 });
    expect(warnings.data[0]).toMatchObject({
      user: { id: "student-1", name: "Ryan Lee" },
      admin: { id: "admin-1", name: "Admin User" },
      reason: "Keep it respectful",
    });
  });

  it("manages thread controls and banned words", async () => {
    const prisma = mockPrisma({
      forumBannedWord: {
        ...mockPrisma().forumBannedWord,
        findMany: jest.fn(async () => [{ id: "word-1", word: "spoiler", createdAt: now }]),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null as never)
          .mockResolvedValue({ id: "word-1", word: "spoiler" } as never),
      },
    });

    await forum.adminPinThread(prisma as never, "thread-1", { isPinned: true });
    await forum.adminLockThread(prisma as never, "thread-1", { isLocked: true });
    await forum.adminDeleteThread(prisma as never, "thread-1");
    await forum.adminApprovePost(prisma as never, "post-1");
    expect(prisma.forumThread.update).toHaveBeenCalledWith({ where: { id: "thread-1" }, data: { isPinned: true } });
    expect(prisma.forumThread.update).toHaveBeenCalledWith({ where: { id: "thread-1" }, data: { isLocked: true } });
    expect(prisma.forumThread.delete).toHaveBeenCalledWith({ where: { id: "thread-1" } });
    expect(prisma.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "ACTIVE" } });

    await expect(forum.listBannedWords(prisma as never)).resolves.toEqual([
      { id: "word-1", word: "spoiler", createdAt: now.toISOString() },
    ]);
    await expect(forum.addBannedWord(prisma as never, { word: "spoiler" })).resolves.toEqual({
      id: "word-1",
      word: "spoiler",
      createdAt: now.toISOString(),
    });
    await forum.deleteBannedWord(prisma as never, "word-1");
    expect(prisma.forumBannedWord.delete).toHaveBeenCalledWith({ where: { id: "word-1" } });

    const missing = mockPrisma({ forumThread: { ...mockPrisma().forumThread, findUnique: jest.fn(async () => null) } });
    await expect(forum.adminPinThread(missing as never, "missing", { isPinned: true })).rejects.toMatchObject({
      statusCode: 404,
      message: "Thread not found",
    });
  });
});
