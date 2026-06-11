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
    isAnonymous: false,
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
    post: { content: "Flagged content", isAnonymous: false, author: author("student-2", "Zoe White") },
    reporter: author("student-3", "Emma Garcia"),
    ...overrides,
  };
}

function warning(overrides: Record<string, unknown> = {}) {
  return {
    id: "warning-1",
    level: "MINOR",
    reason: "Keep it respectful",
    createdAt: now,
    user: { ...author("student-1", "Ryan Lee"), isForumBanned: false },
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
      findFirst: jest.fn(async () => ({ id: "post-1" })),
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

    // An anonymous thread hides the author's real name from other students.
    const anon = mockPrisma({
      forumThread: { ...mockPrisma().forumThread, findMany: jest.fn(async () => [thread({ isAnonymous: true })]) },
    });
    const anonResult = await forum.listThreads(anon as never, { segment: "STUDENT", page: 1, limit: 10 }, "student-2", "STUDENT");
    expect(anonResult.data[0]).toMatchObject({ isAnonymous: true, author: null });
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
        isAnonymous: true,
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

  it("reveals the real name behind anonymous posts to Admin and Tutor only", async () => {
    const prisma = mockPrisma();

    // post-2 is anonymous, authored by student-1 ("Ryan Lee").
    const asAdmin = await forum.getThread(prisma as never, "thread-1", { page: 1, limit: 10 }, "admin-1", "ADMIN");
    expect(asAdmin.posts).toEqual([
      expect.objectContaining({ author: { id: "student-2", name: "Zoe White" } }),
      expect.objectContaining({ author: { id: "student-1", name: "Anonymous", realName: "Ryan Lee" } }),
    ]);

    const asTutor = await forum.getThread(prisma as never, "thread-1", { page: 1, limit: 10 }, "tutor-1", "TUTOR");
    expect(asTutor.posts[1]).toEqual(
      expect.objectContaining({ author: { id: "student-1", name: "Anonymous", realName: "Ryan Lee" } })
    );

    // Another student still sees no author for the anonymous post.
    const asStudent = await forum.getThread(prisma as never, "thread-1", { page: 1, limit: 10 }, "student-2", "STUDENT");
    expect(asStudent.posts[1]).toEqual(expect.objectContaining({ author: null }));
  });

  it("blocks direct student access when the opening post is hidden", async () => {
    const hiddenOpening = mockPrisma({
      forumThread: {
        ...mockPrisma().forumThread,
        findUnique: jest.fn(async () => thread({ posts: [{ status: "HIDDEN" }] })),
      },
    });

    await expect(
      forum.getThread(hiddenOpening as never, "thread-1", { page: 1, limit: 10 }, "student-2", "STUDENT")
    ).rejects.toMatchObject({ statusCode: 404, message: "Thread not found" });
    expect(hiddenOpening.forumPost.findMany).not.toHaveBeenCalled();

    const visibleToAdmin = await forum.getThread(
      hiddenOpening as never,
      "thread-1",
      { page: 1, limit: 10 },
      "admin-1",
      "ADMIN"
    );
    expect(visibleToAdmin.id).toBe("thread-1");
  });

  it("deletes a reply, deletes the whole thread via its opening post, and enforces permissions", async () => {
    // Here post-1 is a reply (opening is a different post) → only the post goes.
    const prisma = mockPrisma({
      forumPost: { ...mockPrisma().forumPost, findFirst: jest.fn(async () => ({ id: "opening-1" })) },
    });

    const replyRes = await forum.deletePost(prisma as never, "post-1", "student-2", "STUDENT");
    await forum.deletePost(prisma as never, "post-1", "admin-1", "ADMIN");
    await forum.deletePost(prisma as never, "post-1", "tutor-1", "TUTOR");
    expect(prisma.forumPost.delete).toHaveBeenCalledWith({ where: { id: "post-1" } });
    expect(prisma.forumThread.delete).not.toHaveBeenCalled();
    expect(replyRes).toEqual({ threadDeleted: false });

    // Deleting the opening (earliest) post deletes the whole thread; replies cascade.
    const opening = mockPrisma({
      forumPost: { ...mockPrisma().forumPost, findFirst: jest.fn(async () => ({ id: "post-1" })) },
    });
    const openingRes = await forum.deletePost(opening as never, "post-1", "admin-1", "ADMIN");
    expect(opening.forumThread.delete).toHaveBeenCalledWith({ where: { id: "thread-1" } });
    expect(opening.forumPost.delete).not.toHaveBeenCalled();
    expect(openingRes).toEqual({ threadDeleted: true });

    const firstFlag = await forum.flagPost(prisma as never, "post-1", "student-3", { reason: "SPAM", note: undefined });
    expect(firstFlag).toEqual({ success: true, alreadyReported: false });
    expect(prisma.forumFlag.create).toHaveBeenCalledWith({
      data: { postId: "post-1", reporterId: "student-3", reason: "SPAM", note: null },
    });
    // Flagging records the report but must NOT change the post's status/visibility.
    expect(prisma.forumPost.update).not.toHaveBeenCalled();

    // Flagging is idempotent: a duplicate report from the same user is a benign
    // no-op (alreadyReported), not an error, and creates no second flag row.
    const dup = mockPrisma({
      forumFlag: { ...mockPrisma().forumFlag, findUnique: jest.fn(async () => flag()) },
    });
    const dupFlag = await forum.flagPost(dup as never, "post-1", "student-3", { reason: "SPAM" });
    expect(dupFlag).toEqual({ success: true, alreadyReported: true });
    expect(dup.forumFlag.create).not.toHaveBeenCalled();

    await expect(forum.deletePost(prisma as never, "post-1", "student-1", "STUDENT")).rejects.toMatchObject({
      statusCode: 403,
      message: "You are not allowed to delete this post",
    });
    await expect(forum.flagPost(prisma as never, "post-1", "student-2", { reason: "OTHER" })).rejects.toMatchObject({
      statusCode: 400,
      message: "You cannot flag your own post",
    });
  });

  it("edits own post, and rejects others' / removed / missing posts", async () => {
    const prisma = mockPrisma();

    // post-1 is authored by student-2 → owner can edit.
    await forum.editPost(prisma as never, "post-1", "student-2", "Updated content");
    expect(prisma.forumPost.update).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: { content: "Updated content", updatedAt: expect.any(Date) },
    });

    // Not the author → 403.
    await expect(forum.editPost(prisma as never, "post-1", "student-1", "Hi")).rejects.toMatchObject({
      statusCode: 403,
      message: "You can only edit your own posts",
    });

    // Removed (REJECTED) post → 403.
    const removed = mockPrisma({
      forumPost: { ...mockPrisma().forumPost, findUnique: jest.fn(async () => ({ authorId: "student-2", status: "REJECTED" })) },
    });
    await expect(forum.editPost(removed as never, "post-1", "student-2", "Hi")).rejects.toMatchObject({
      statusCode: 403,
      message: "This post cannot be edited",
    });

    // Missing post → 404.
    const missing = mockPrisma({
      forumPost: { ...mockPrisma().forumPost, findUnique: jest.fn(async () => null) },
    });
    await expect(forum.editPost(missing as never, "missing", "student-2", "Hi")).rejects.toMatchObject({
      statusCode: 404,
      message: "Post not found",
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
      author: { id: "student-2", name: "Zoe White" },
      isAnonymous: false,
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

    // HIDE → post HIDDEN; REMOVE → post REMOVED (flag resolved as APPROVED).
    await forum.adminReviewFlag(prisma as never, "flag-1", "admin-1", { action: "HIDE" });
    expect(prisma.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "HIDDEN" } });

    await forum.adminReviewFlag(prisma as never, "flag-1", "admin-1", { action: "REMOVE" });
    expect(prisma.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "REMOVED" } });

    const reviewed = mockPrisma({
      forumFlag: { ...mockPrisma().forumFlag, findUnique: jest.fn(async () => ({ postId: "post-1", status: "APPROVED" })) },
    });
    await expect(forum.adminReviewFlag(reviewed as never, "flag-1", "admin-1", { action: "APPROVE" })).rejects.toMatchObject({
      statusCode: 409,
      message: "Flag already reviewed",
    });
  });

  it("restores hidden/removed posts with role checks", async () => {
    // Tutor restores a HIDDEN post.
    const hidden = mockPrisma({ forumPost: { ...mockPrisma().forumPost, findUnique: jest.fn(async () => ({ status: "HIDDEN" })) } });
    await forum.restorePost(hidden as never, "post-1", "TUTOR");
    expect(hidden.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "ACTIVE" } });

    // Tutor cannot restore a REMOVED post.
    const removed = mockPrisma({ forumPost: { ...mockPrisma().forumPost, findUnique: jest.fn(async () => ({ status: "REMOVED" })) } });
    await expect(forum.restorePost(removed as never, "post-1", "TUTOR")).rejects.toMatchObject({
      statusCode: 403,
      message: "Only admins can restore removed posts",
    });

    // Admin can restore a REMOVED post.
    const removedAdmin = mockPrisma({ forumPost: { ...mockPrisma().forumPost, findUnique: jest.fn(async () => ({ status: "REMOVED" })) } });
    await forum.restorePost(removedAdmin as never, "post-1", "ADMIN");
    expect(removedAdmin.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "ACTIVE" } });

    // An ACTIVE post cannot be restored.
    await expect(forum.restorePost(mockPrisma() as never, "post-1", "ADMIN")).rejects.toMatchObject({
      statusCode: 400,
      message: "Post is not hidden or removed",
    });

    // Missing post → 404.
    const missing = mockPrisma({ forumPost: { ...mockPrisma().forumPost, findUnique: jest.fn(async () => null) } });
    await expect(forum.restorePost(missing as never, "missing", "ADMIN")).rejects.toMatchObject({
      statusCode: 404,
      message: "Post not found",
    });
  });

  it("lists moderated posts scoped by role", async () => {
    const moderatedRow = {
      id: "post-9",
      content: "A removed post",
      status: "HIDDEN",
      createdAt: now,
      author: author("student-2", "Zoe White"),
      thread: { id: "thread-1", title: "Topic" },
    };
    const prisma = mockPrisma({
      forumPost: { ...mockPrisma().forumPost, findMany: jest.fn(async () => [moderatedRow]) },
    });

    const adminList = await forum.listModeratedPosts(prisma as never, "ADMIN");
    expect(prisma.forumPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["HIDDEN", "REMOVED"] } } })
    );
    expect(adminList[0]).toMatchObject({
      id: "post-9",
      status: "HIDDEN",
      author: { id: "student-2", name: "Zoe White" },
      threadId: "thread-1",
      threadTitle: "Topic",
    });

    // Tutors only ever query HIDDEN posts.
    const tutorPrisma = mockPrisma({ forumPost: { ...mockPrisma().forumPost, findMany: jest.fn(async () => []) } });
    await forum.listModeratedPosts(tutorPrisma as never, "TUTOR");
    expect(tutorPrisma.forumPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["HIDDEN"] } } })
    );
  });

  it("issues warnings (role-gated), auto-escalates, bans, and lifts bans", async () => {
    const prisma = mockPrisma();

    // Tutor issues a MINOR warning + the user is notified.
    await forum.adminWarnUser(prisma as never, "student-1", "tutor-1", "TUTOR", {
      level: "MINOR",
      reason: "First offence",
    });
    expect(prisma.forumWarning.create).toHaveBeenCalledWith({
      data: { userId: "student-1", adminId: "tutor-1", level: "MINOR", reason: "First offence" },
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ userId: "student-1", type: "FORUM_WARNING" })
    );

    // Tutor cannot issue a BAN.
    await expect(
      forum.adminWarnUser(prisma as never, "student-1", "tutor-1", "TUTOR", { level: "BAN", reason: "x" })
    ).rejects.toMatchObject({ statusCode: 403, message: "Only admins can issue a forum ban" });

    // Admin BAN sets the per-forum ban flag.
    await forum.adminWarnUser(prisma as never, "student-1", "admin-1", "ADMIN", { level: "BAN", reason: "Repeated" });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "student-1" }, data: { isForumBanned: true } });

    // 2nd MINOR auto-escalates to a system MAJOR.
    const escalate = mockPrisma({
      forumWarning: { ...mockPrisma().forumWarning, count: jest.fn(async () => 2) },
    });
    await forum.adminWarnUser(escalate as never, "student-1", "tutor-1", "TUTOR", { level: "MINOR", reason: "Second" });
    expect(escalate.forumWarning.create).toHaveBeenCalledWith({
      data: { userId: "student-1", adminId: "tutor-1", level: "MAJOR", reason: "Auto-escalated from 2 MINOR warnings." },
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      escalate,
      expect.objectContaining({
        userId: "student-1",
        type: "FORUM_WARNING",
        title: "Major forum warning issued",
        message: "You received 2 minor forum warnings. Posting is restricted for 24 hours.",
        data: expect.objectContaining({ level: "MAJOR" }),
      })
    );

    // Lift ban clears the flag without touching warning history.
    await forum.liftForumBan(prisma as never, "student-1");
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "student-1" }, data: { isForumBanned: false } });

    // Warnings list exposes the user's current ban state.
    const warnings = await forum.adminListWarnings(prisma as never, { userId: "student-1", page: 1, limit: 10 });
    expect(warnings.data[0]).toMatchObject({
      user: { id: "student-1", name: "Ryan Lee" },
      admin: { id: "admin-1", name: "Admin User" },
      isForumBanned: false,
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
    await forum.adminHidePost(prisma as never, "post-1", { isHidden: true });
    await forum.adminHidePost(prisma as never, "post-1", { isHidden: false });
    await forum.adminRemovePost(prisma as never, "post-1");
    await forum.adminDeleteThread(prisma as never, "thread-1");
    await forum.adminApprovePost(prisma as never, "post-1");
    expect(prisma.forumThread.update).toHaveBeenCalledWith({ where: { id: "thread-1" }, data: { isPinned: true } });
    expect(prisma.forumThread.update).toHaveBeenCalledWith({ where: { id: "thread-1" }, data: { isLocked: true } });
    expect(prisma.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "HIDDEN" } });
    expect(prisma.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "ACTIVE" } });
    expect(prisma.forumPost.update).toHaveBeenCalledWith({ where: { id: "post-1" }, data: { status: "REMOVED" } });
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

    const removed = mockPrisma({
      forumPost: { ...mockPrisma().forumPost, findUnique: jest.fn(async () => ({ status: "REMOVED" })) },
    });
    await expect(forum.adminHidePost(removed as never, "post-1", { isHidden: true })).rejects.toMatchObject({
      statusCode: 400,
      message: "Removed posts cannot be hidden",
    });

    const missingPost = mockPrisma({
      forumPost: { ...mockPrisma().forumPost, findUnique: jest.fn(async () => null) },
    });
    await expect(forum.adminRemovePost(missingPost as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Post not found",
    });
  });
});
