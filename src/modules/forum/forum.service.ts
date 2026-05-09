import type { PrismaClient } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";
import { decryptField } from "../../utils/field-encryption.js";
import { createNotification } from "../../lib/notify.js";
import type {
  CreateThreadBody,
  CreatePostBody,
  FlagPostBody,
  ListThreadsQuery,
  ListPostsQuery,
  AdminListFlagsQuery,
  AdminReviewFlagBody,
  AdminWarnUserBody,
  AdminListWarningsQuery,
  AdminPinThreadBody,
  AdminLockThreadBody,
  AdminBannedWordBody,
} from "./forum.schema.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskAuthor(author: { id: string; fullName: string } | null, isAnonymous: boolean, viewerId?: string) {
  if (!isAnonymous) {
    return author ? { id: author.id, name: decryptField(author.fullName) } : null;
  }
  // Author can always see their own anonymous post
  if (author && viewerId && author.id === viewerId) {
    return { id: author.id, name: "Anonymous (You)" };
  }
  return null;
}

async function getBannedWords(prisma: PrismaClient): Promise<string[]> {
  const words = await prisma.forumBannedWord.findMany({ select: { word: true } });
  return words.map((w) => w.word.toLowerCase());
}

function containsBannedWord(content: string, bannedWords: string[]): boolean {
  const lower = content.toLowerCase();
  return bannedWords.some((word) => lower.includes(word));
}

function assertCanAccessSegment(viewerRole: string, segment: "STUDENT" | "PARENT") {
  if (viewerRole === "ADMIN" || viewerRole === "TUTOR") return;
  if (viewerRole === segment) return;
  throw createHttpError(403, "Forbidden");
}

// ── Threads ───────────────────────────────────────────────────────────────────

export async function listThreads(
  prisma: PrismaClient,
  query: ListThreadsQuery,
  viewerId: string,
  viewerRole: string
) {
  const { segment, page, limit, status } = query;
  assertCanAccessSegment(viewerRole, segment);
  const skip = (page - 1) * limit;

  const visiblePostWhere = viewerRole === "ADMIN" && status
    ? { status: status as any }
    : { status: "ACTIVE" as const };
  const where = {
    segment: segment as any,
    posts: { some: visiblePostWhere },
  };

  const [threads, total] = await Promise.all([
    prisma.forumThread.findMany({
      where,
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
      select: {
        id: true,
        segment: true,
        title: true,
        isPinned: true,
        isLocked: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, fullName: true } },
        _count: { select: { posts: { where: { status: "ACTIVE" } } } },
        posts: {
          where: visiblePostWhere,
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, isAnonymous: true, authorId: true },
        },
      },
    }),
    prisma.forumThread.count({ where }),
  ]);

  return {
    data: threads.map((t) => ({
      id: t.id,
      segment: t.segment,
      title: t.title,
      author: maskAuthor(t.author, false, viewerId),
      isAnonymous: false,
      isPinned: t.isPinned,
      isLocked: t.isLocked,
      postCount: Math.max(t._count.posts - 1, 0),
      lastPostAt: t._count.posts > 1 ? t.posts[0]?.createdAt.toISOString() ?? null : null,
      status: status ?? "ACTIVE" as const,
      createdAt: t.createdAt.toISOString(),
    })),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function createThread(
  prisma: PrismaClient,
  authorId: string,
  authorRole: string,
  segment: "STUDENT" | "PARENT",
  body: CreateThreadBody
) {
  assertCanAccessSegment(authorRole, segment);
  // Check if user is suspended
  const user = await prisma.user.findUnique({
    where: { id: authorId },
    select: { status: true },
  });
  if (!user) throw createHttpError(404, "User not found");
  if (user.status === "SUSPENDED" || user.status === "BANNED") {
    throw createHttpError(403, "Your account has been suspended from posting");
  }

  const bannedWords = await getBannedWords(prisma);
  const hasOffendingContent = containsBannedWord(body.title + " " + body.content, bannedWords);

  // Auto-set to UNDER_REVIEW if banned words detected
  const postStatus = hasOffendingContent ? "UNDER_REVIEW" : "ACTIVE";

  const thread = await prisma.forumThread.create({
    data: {
      authorId,
      segment: segment as any,
      title: body.title.trim(),
      posts: {
        create: {
          authorId,
          content: body.content.trim(),
          isAnonymous: body.isAnonymous,
          status: postStatus as any,
        },
      },
    },
    select: {
      id: true,
      segment: true,
      title: true,
      isPinned: true,
      isLocked: true,
      createdAt: true,
      author: { select: { id: true, fullName: true } },
    },
  });

  return {
    id: thread.id,
    segment: thread.segment,
    title: thread.title,
    author: maskAuthor(thread.author, body.isAnonymous, authorId),
    isAnonymous: body.isAnonymous,
    isPinned: thread.isPinned,
    isLocked: thread.isLocked,
    postCount: 0,
    lastPostAt: thread.createdAt.toISOString(),
    status: postStatus,
    createdAt: thread.createdAt.toISOString(),
    underReview: hasOffendingContent,
  };
}

export async function getThread(
  prisma: PrismaClient,
  threadId: string,
  query: ListPostsQuery,
  viewerId: string,
  viewerRole: string
) {
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  const thread = await prisma.forumThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      segment: true,
      title: true,
      isPinned: true,
      isLocked: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, fullName: true } },
    },
  });

  if (!thread) throw createHttpError(404, "Thread not found");
  assertCanAccessSegment(viewerRole, thread.segment as "STUDENT" | "PARENT");

  const postWhere = viewerRole === "ADMIN"
    ? { threadId }
    : { threadId, status: "ACTIVE" as const };

  const [posts, total] = await Promise.all([
    prisma.forumPost.findMany({
      where: postWhere,
      orderBy: { createdAt: "asc" },
      skip,
      take: limit,
      select: {
        id: true,
        threadId: true,
        content: true,
        isAnonymous: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, fullName: true } },
        _count: { select: { flags: { where: { status: "PENDING" } } } },
      },
    }),
    prisma.forumPost.count({ where: postWhere }),
  ]);

  return {
    id: thread.id,
    segment: thread.segment,
    title: thread.title,
    author: maskAuthor(thread.author, false, viewerId),
    isAnonymous: false,
    isPinned: thread.isPinned,
    isLocked: thread.isLocked,
    postCount: Math.max(total - 1, 0),
    lastPostAt: total > 1 ? posts.at(-1)?.createdAt.toISOString() ?? null : null,
    status: "ACTIVE" as const,
    createdAt: thread.createdAt.toISOString(),
    posts: posts.map((p) => ({
      id: p.id,
      threadId: p.threadId,
      author: maskAuthor(p.author, p.isAnonymous, viewerId),
      isAnonymous: p.isAnonymous,
      content: p.content,
      status: p.status,
      flagCount: p._count.flags,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function createPost(
  prisma: PrismaClient,
  threadId: string,
  authorId: string,
  authorRole: string,
  body: CreatePostBody
) {
  const user = await prisma.user.findUnique({
    where: { id: authorId },
    select: { status: true },
  });
  if (!user) throw createHttpError(404, "User not found");
  if (user.status === "SUSPENDED" || user.status === "BANNED") {
    throw createHttpError(403, "Your account has been suspended from posting");
  }

  const thread = await prisma.forumThread.findUnique({
    where: { id: threadId },
    select: { isLocked: true, segment: true, authorId: true, title: true },
  });
  if (!thread) throw createHttpError(404, "Thread not found");
  assertCanAccessSegment(authorRole, thread.segment as "STUDENT" | "PARENT");
  if (thread.isLocked) throw createHttpError(403, "This thread has been locked");

  const bannedWords = await getBannedWords(prisma);
  const hasOffendingContent = containsBannedWord(body.content, bannedWords);
  const postStatus = hasOffendingContent ? "UNDER_REVIEW" : "ACTIVE";

  const post = await prisma.forumPost.create({
    data: {
      threadId,
      authorId,
      content: body.content.trim(),
      isAnonymous: body.isAnonymous,
      status: postStatus as any,
    },
    select: {
      id: true,
      threadId: true,
      content: true,
      isAnonymous: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, fullName: true } },
    },
  });

  // Update thread updatedAt for sort order
  await prisma.forumThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });

  // Notify thread owner — skip if replying to own thread or post is under review
  if (thread.authorId !== authorId && postStatus === "ACTIVE") {
    void createNotification(prisma, {
      userId: thread.authorId,
      type: "FORUM_REPLY",
      title: "New reply on your thread",
      message: `Someone replied to your thread: "${thread.title}"`,
      data: { threadId, postId: post.id },
    });
  }

  return {
    id: post.id,
    threadId: post.threadId,
    author: maskAuthor(post.author, post.isAnonymous, authorId),
    isAnonymous: post.isAnonymous,
    content: post.content,
    status: post.status,
    flagCount: 0,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    underReview: hasOffendingContent,
  };
}

export async function deletePost(
  prisma: PrismaClient,
  postId: string,
  userId: string,
  userRole: string
) {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { authorId: true },
  });
  if (!post) throw createHttpError(404, "Post not found");
  if (post.authorId !== userId && userRole !== "ADMIN") {
    throw createHttpError(403, "You are not allowed to delete this post");
  }
  await prisma.forumPost.delete({ where: { id: postId } });
}

// ── Flagging ──────────────────────────────────────────────────────────────────

export async function flagPost(
  prisma: PrismaClient,
  postId: string,
  reporterId: string,
  body: FlagPostBody
) {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true },
  });
  if (!post) throw createHttpError(404, "Post not found");
  if (post.authorId === reporterId) {
    throw createHttpError(400, "You cannot flag your own post");
  }

  const existing = await prisma.forumFlag.findUnique({
    where: { postId_reporterId: { postId, reporterId } },
  });
  if (existing) throw createHttpError(409, "You have already flagged this post");

  await prisma.forumFlag.create({
    data: {
      postId,
      reporterId,
      reason: body.reason as any,
      note: body.note ?? null,
    },
  });

  // Auto-put post under review when first flagged
  await prisma.forumPost.update({
    where: { id: postId },
    data: { status: "UNDER_REVIEW" },
  });

  return { success: true };
}

// ── Admin: Flag Management ────────────────────────────────────────────────────

export async function adminListFlags(
  prisma: PrismaClient,
  query: AdminListFlagsQuery
) {
  const { status, page, limit } = query;
  const skip = (page - 1) * limit;
  const where = status ? { status: status as any } : {};

  const [flags, total] = await Promise.all([
    prisma.forumFlag.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        postId: true,
        reason: true,
        note: true,
        status: true,
        createdAt: true,
        post: { select: { content: true } },
        reporter: { select: { id: true, fullName: true } },
      },
    }),
    prisma.forumFlag.count({ where }),
  ]);

  return {
    data: flags.map((f) => ({
      id: f.id,
      postId: f.postId,
      postContent: f.post.content,
      reporter: { id: f.reporter.id, name: decryptField(f.reporter.fullName) },
      reason: f.reason,
      note: f.note ?? null,
      status: f.status,
      createdAt: f.createdAt.toISOString(),
    })),
    meta: {
      page, limit, total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function adminReviewFlag(
  prisma: PrismaClient,
  flagId: string,
  adminId: string,
  body: AdminReviewFlagBody
) {
  const flag = await prisma.forumFlag.findUnique({
    where: { id: flagId },
    select: { postId: true, status: true },
  });
  if (!flag) throw createHttpError(404, "Flag not found");
  if (flag.status !== "PENDING") throw createHttpError(409, "Flag already reviewed");

  await prisma.forumFlag.update({
    where: { id: flagId },
    data: {
      status: body.action === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewedBy: adminId,
      reviewedAt: new Date(),
    },
  });

  // If approved: post stays UNDER_REVIEW (admin can separately delete it)
  // If rejected: restore post to ACTIVE
  if (body.action === "REJECT") {
    await prisma.forumPost.update({
      where: { id: flag.postId },
      data: { status: "ACTIVE" },
    });
  } else {
    // When approved, mark post as REJECTED to hide it
    await prisma.forumPost.update({
      where: { id: flag.postId },
      data: { status: "REJECTED" },
    });
  }

  return { success: true };
}

// ── Admin: Warnings ───────────────────────────────────────────────────────────

export async function adminWarnUser(
  prisma: PrismaClient,
  userId: string,
  adminId: string,
  body: AdminWarnUserBody
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true },
  });
  if (!user) throw createHttpError(404, "User not found");

  await prisma.forumWarning.create({
    data: {
      userId,
      adminId,
      level: body.level as any,
      reason: body.reason,
    },
  });

  // If SUSPEND level, update user status
  if (body.level === "SUSPEND") {
    await prisma.user.update({
      where: { id: userId },
      data: { status: "SUSPENDED" },
    });
  }

  return { success: true };
}

export async function adminListWarnings(
  prisma: PrismaClient,
  query: AdminListWarningsQuery
) {
  const { userId, page, limit } = query;
  const skip = (page - 1) * limit;
  const where = userId ? { userId } : {};

  const [warnings, total] = await Promise.all([
    prisma.forumWarning.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        level: true,
        reason: true,
        createdAt: true,
        user: { select: { id: true, fullName: true } },
        admin: { select: { id: true, fullName: true } },
      },
    }),
    prisma.forumWarning.count({ where }),
  ]);

  return {
    data: warnings.map((w) => ({
      id: w.id,
      user: { id: w.user.id, name: decryptField(w.user.fullName) },
      admin: { id: w.admin.id, name: decryptField(w.admin.fullName) },
      level: w.level,
      reason: w.reason,
      createdAt: w.createdAt.toISOString(),
    })),
    meta: {
      page, limit, total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// ── Admin: Thread controls ────────────────────────────────────────────────────

export async function adminPinThread(
  prisma: PrismaClient,
  threadId: string,
  body: AdminPinThreadBody
) {
  const thread = await prisma.forumThread.findUnique({ where: { id: threadId } });
  if (!thread) throw createHttpError(404, "Thread not found");
  await prisma.forumThread.update({
    where: { id: threadId },
    data: { isPinned: body.isPinned },
  });
  return { success: true };
}

export async function adminLockThread(
  prisma: PrismaClient,
  threadId: string,
  body: AdminLockThreadBody
) {
  const thread = await prisma.forumThread.findUnique({ where: { id: threadId } });
  if (!thread) throw createHttpError(404, "Thread not found");
  await prisma.forumThread.update({
    where: { id: threadId },
    data: { isLocked: body.isLocked },
  });
  return { success: true };
}

export async function adminDeleteThread(prisma: PrismaClient, threadId: string) {
  const thread = await prisma.forumThread.findUnique({ where: { id: threadId } });
  if (!thread) throw createHttpError(404, "Thread not found");
  await prisma.forumThread.delete({ where: { id: threadId } });
}

export async function adminApprovePost(prisma: PrismaClient, postId: string) {
  const post = await prisma.forumPost.findUnique({ where: { id: postId } });
  if (!post) throw createHttpError(404, "Post not found");
  await prisma.forumPost.update({ where: { id: postId }, data: { status: "ACTIVE" } });
  return { success: true };
}

// ── Admin: Banned Words ───────────────────────────────────────────────────────

export async function listBannedWords(prisma: PrismaClient) {
  const words = await prisma.forumBannedWord.findMany({
    orderBy: { word: "asc" },
    select: { id: true, word: true, createdAt: true },
  });
  return words.map((w) => ({ ...w, createdAt: w.createdAt.toISOString() }));
}

export async function addBannedWord(prisma: PrismaClient, body: AdminBannedWordBody) {
  const existing = await prisma.forumBannedWord.findUnique({ where: { word: body.word } });
  if (existing) throw createHttpError(409, "Word already in list");
  const created = await prisma.forumBannedWord.create({
    data: { word: body.word },
    select: { id: true, word: true, createdAt: true },
  });
  return { ...created, createdAt: created.createdAt.toISOString() };
}

export async function deleteBannedWord(prisma: PrismaClient, wordId: string) {
  const existing = await prisma.forumBannedWord.findUnique({ where: { id: wordId } });
  if (!existing) throw createHttpError(404, "Word not found");
  await prisma.forumBannedWord.delete({ where: { id: wordId } });
}
