import type { PrismaClient, Prisma, ForumStatus } from "@prisma/client";
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
  AdminHidePostBody,
  AdminBannedWordBody,
} from "./forum.schema.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskAuthor(
  author: { id: string; fullName: string } | null,
  isAnonymous: boolean,
  viewerId?: string,
  viewerRole?: string
) {
  if (!isAnonymous) {
    return author ? { id: author.id, name: decryptField(author.fullName) } : null;
  }
  // Admin and Tutor can see the real name behind anonymous posts for moderation.
  if (author && (viewerRole === "ADMIN" || viewerRole === "TUTOR")) {
    return { id: author.id, name: "Anonymous", realName: decryptField(author.fullName) };
  }
  // The author can always see their own anonymous post.
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

// Which post statuses a viewer may see: students/parents only ACTIVE; tutors
// everything except REMOVED; admins everything.
function postStatusWhere(viewerRole: string): Prisma.ForumPostWhereInput {
  if (viewerRole === "ADMIN") return {};
  if (viewerRole === "TUTOR") return { status: { notIn: ["REMOVED"] } };
  return { status: "ACTIVE" };
}

// Whether a single post status is visible to the viewer (mirror of the where above).
function isPostVisible(status: ForumStatus, viewerRole: string): boolean {
  if (viewerRole === "ADMIN") return true;
  if (viewerRole === "TUTOR") return status !== "REMOVED";
  return status === "ACTIVE";
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

  const visiblePostWhere: Prisma.ForumPostWhereInput =
    viewerRole === "ADMIN" && status ? { status } : postStatusWhere(viewerRole);
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
        isAnonymous: true,
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
      author: maskAuthor(t.author, t.isAnonymous, viewerId, viewerRole),
      isAnonymous: t.isAnonymous,
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
      isAnonymous: body.isAnonymous,
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
    author: maskAuthor(thread.author, body.isAnonymous, authorId, authorRole),
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
      isAnonymous: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, fullName: true } },
      // Earliest post = the opening post; used to detect a moderated-out opener
      // (cheap nested select, no extra round-trip).
      posts: { orderBy: { createdAt: "asc" }, take: 1, select: { status: true } },
    },
  });

  if (!thread) throw createHttpError(404, "Thread not found");
  assertCanAccessSegment(viewerRole, thread.segment as "STUDENT" | "PARENT");

  // True when the opening post exists but is hidden/removed from this viewer —
  // the FE then shows a placeholder instead of mislabelling a reply as the opener.
  const openingStatus = thread.posts[0]?.status;
  const openingPostRemoved = openingStatus != null && !isPostVisible(openingStatus, viewerRole);
  if (openingPostRemoved) {
    throw createHttpError(404, "Thread not found");
  }

  const postWhere: Prisma.ForumPostWhereInput = { threadId, ...postStatusWhere(viewerRole) };

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
    author: maskAuthor(thread.author, thread.isAnonymous, viewerId, viewerRole),
    isAnonymous: thread.isAnonymous,
    isPinned: thread.isPinned,
    isLocked: thread.isLocked,
    openingPostRemoved,
    postCount: Math.max(total - 1, 0),
    lastPostAt: total > 1 ? posts.at(-1)?.createdAt.toISOString() ?? null : null,
    status: "ACTIVE" as const,
    createdAt: thread.createdAt.toISOString(),
    posts: posts.map((p) => ({
      id: p.id,
      threadId: p.threadId,
      author: maskAuthor(p.author, p.isAnonymous, viewerId, viewerRole),
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
    author: maskAuthor(post.author, post.isAnonymous, authorId, authorRole),
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
): Promise<{ threadDeleted: boolean }> {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { authorId: true, threadId: true },
  });
  if (!post) throw createHttpError(404, "Post not found");
  // Owners delete their own; ADMIN and TUTOR can delete any post (moderation).
  if (post.authorId !== userId && userRole !== "ADMIN" && userRole !== "TUTOR") {
    throw createHttpError(403, "You are not allowed to delete this post");
  }

  // The opening post (earliest in the thread) IS the thread — deleting it removes
  // the whole thread, and all replies cascade via the FK (onDelete: Cascade).
  const opening = await prisma.forumPost.findFirst({
    where: { threadId: post.threadId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (opening?.id === postId) {
    await prisma.forumThread.delete({ where: { id: post.threadId } });
    return { threadDeleted: true };
  }

  await prisma.forumPost.delete({ where: { id: postId } });
  return { threadDeleted: false };
}

export async function editPost(
  prisma: PrismaClient,
  postId: string,
  editorId: string,
  content: string
): Promise<void> {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { authorId: true, status: true },
  });
  if (!post) throw createHttpError(404, "Post not found");
  // Only the author may edit their own post (moderators delete, not edit).
  if (post.authorId !== editorId) throw createHttpError(403, "You can only edit your own posts");
  // A post that's been moderated out (rejected/hidden/removed) can't be edited.
  if (post.status === "REJECTED" || post.status === "HIDDEN" || post.status === "REMOVED") {
    throw createHttpError(403, "This post cannot be edited");
  }

  await prisma.forumPost.update({
    where: { id: postId },
    data: { content, updatedAt: new Date() },
  });
}

export async function restorePost(
  prisma: PrismaClient,
  postId: string,
  actorRole: string
): Promise<void> {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { status: true },
  });
  if (!post) throw createHttpError(404, "Post not found");
  if (post.status !== "HIDDEN" && post.status !== "REMOVED") {
    throw createHttpError(400, "Post is not hidden or removed");
  }
  // Only Admin can restore a REMOVED post; Tutor may only restore HIDDEN.
  if (post.status === "REMOVED" && actorRole !== "ADMIN") {
    throw createHttpError(403, "Only admins can restore removed posts");
  }
  await prisma.forumPost.update({ where: { id: postId }, data: { status: "ACTIVE" } });
}

export async function adminHidePost(
  prisma: PrismaClient,
  postId: string,
  body: AdminHidePostBody
): Promise<void> {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { status: true },
  });
  if (!post) throw createHttpError(404, "Post not found");
  if (post.status === "REMOVED") {
    throw createHttpError(400, "Removed posts cannot be hidden");
  }

  await prisma.forumPost.update({
    where: { id: postId },
    data: { status: body.isHidden ? "HIDDEN" : "ACTIVE" },
  });
}

export async function adminRemovePost(prisma: PrismaClient, postId: string): Promise<void> {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { id: true },
  });
  if (!post) throw createHttpError(404, "Post not found");

  await prisma.forumPost.update({
    where: { id: postId },
    data: { status: "REMOVED" },
  });
}

// List moderated (HIDDEN/REMOVED) posts. Tutors only see HIDDEN; REMOVED is
// admin-only. Author name is decrypted (this endpoint is ADMIN/TUTOR-only).
export async function listModeratedPosts(prisma: PrismaClient, viewerRole: string) {
  const statuses: ForumStatus[] = viewerRole === "ADMIN" ? ["HIDDEN", "REMOVED"] : ["HIDDEN"];

  const posts = await prisma.forumPost.findMany({
    where: { status: { in: statuses } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      content: true,
      status: true,
      createdAt: true,
      author: { select: { id: true, fullName: true } },
      thread: { select: { id: true, title: true } },
    },
  });

  return posts.map((p) => ({
    id: p.id,
    content: p.content.length > 200 ? `${p.content.slice(0, 200)}…` : p.content,
    author: p.author ? { id: p.author.id, name: decryptField(p.author.fullName) } : null,
    status: p.status,
    threadId: p.thread.id,
    threadTitle: p.thread.title,
    createdAt: p.createdAt.toISOString(),
  }));
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
  // Flagging is idempotent: a duplicate report from the same user is not an error.
  // The report already exists, so we just tell the client it was already reported
  // (a 409 here forced the FE through the error path, where the message gets
  // redacted to a generic error for students — confusing for a benign outcome).
  if (existing) return { success: true, alreadyReported: true };

  await prisma.forumFlag.create({
    data: {
      postId,
      reporterId,
      reason: body.reason as any,
      note: body.note ?? null,
    },
  });

  // Recording a flag does NOT change the post's visibility — it stays visible to
  // everyone until a moderator explicitly hides/removes it. (Auto-hiding on a
  // single flag is a flag-to-hide abuse vector; per SME-122 a post is hidden
  // from students only via an explicit HIDE/REMOVE moderation action.)
  return { success: true, alreadyReported: false };
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
        post: {
          select: {
            content: true,
            isAnonymous: true,
            author: { select: { id: true, fullName: true } },
          },
        },
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
      // This endpoint is ADMIN/TUTOR-only, so reveal the real author (even for
      // anonymous posts) — moderators need it to warn the right user.
      author: f.post.author ? { id: f.post.author.id, name: decryptField(f.post.author.fullName) } : null,
      isAnonymous: f.post.isAnonymous,
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

  // REJECT dismisses the flag; every other action resolves it as actioned.
  await prisma.forumFlag.update({
    where: { id: flagId },
    data: {
      status: body.action === "REJECT" ? "REJECTED" : "APPROVED",
      reviewedBy: adminId,
      reviewedAt: new Date(),
    },
  });

  // Map the review action to the resulting post status:
  //  REJECT → ACTIVE (dismiss, keep visible)   HIDE → HIDDEN (reversible)
  //  REMOVE → REMOVED (admin-only restore)     APPROVE → REJECTED (legacy hide)
  const postStatus: ForumStatus =
    body.action === "REJECT"
      ? "ACTIVE"
      : body.action === "HIDE"
        ? "HIDDEN"
        : body.action === "REMOVE"
          ? "REMOVED"
          : "REJECTED";
  await prisma.forumPost.update({
    where: { id: flag.postId },
    data: { status: postStatus },
  });

  return { success: true };
}

// ── Admin: Warnings ───────────────────────────────────────────────────────────

export async function adminWarnUser(
  prisma: PrismaClient,
  userId: string,
  actorId: string,
  actorRole: string,
  body: AdminWarnUserBody
) {
  // Only Admin can issue a forum ban; Tutor may issue MINOR/MAJOR.
  if (body.level === "BAN" && actorRole !== "ADMIN") {
    throw createHttpError(403, "Only admins can issue a forum ban");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw createHttpError(404, "User not found");

  await prisma.forumWarning.create({
    data: { userId, adminId: actorId, level: body.level, reason: body.reason },
  });

  let autoEscalatedToMajor = false;

  if (body.level === "BAN") {
    // Forum ban is per-forum (separate from account-wide users.status).
    await prisma.user.update({
      where: { id: userId },
      data: { isForumBanned: true },
    });
  } else if (body.level === "MINOR") {
    // Auto-escalation: a 2nd MINOR on the same user adds a system MAJOR warning.
    const minorCount = await prisma.forumWarning.count({
      where: { userId, level: "MINOR" },
    });
    if (minorCount >= 2) {
      await prisma.forumWarning.create({
        data: {
          userId,
          adminId: actorId,
          level: "MAJOR",
          reason: "Auto-escalated from 2 MINOR warnings.",
        },
      });
      autoEscalatedToMajor = true;
    }
  }

  // Notify the user so the moderator action isn't silent. (data.url drives the
  // notification click-through on the frontend.)
  const isBan = body.level === "BAN";
  void createNotification(prisma, {
    userId,
    type: "FORUM_WARNING",
    title: isBan ? "Forum access suspended" : "Forum warning issued",
    message: isBan
      ? `A moderator has suspended your forum access. Reason: ${body.reason}`
      : `A moderator has issued a ${body.level} warning about your forum activity. Reason: ${body.reason}`,
    data: { level: body.level, reason: body.reason, url: "/dashboard/forum" },
  });

  if (autoEscalatedToMajor) {
    const reason = "Auto-escalated from 2 MINOR warnings.";
    void createNotification(prisma, {
      userId,
      type: "FORUM_WARNING",
      title: "Major forum warning issued",
      message: "You received 2 minor forum warnings. Posting is restricted for 24 hours.",
      data: { level: "MAJOR", reason, url: "/dashboard/forum" },
    });
  }

  return { success: true };
}

export async function liftForumBan(prisma: PrismaClient, userId: string): Promise<void> {
  // Lifts the ban only; warning history is retained.
  await prisma.user.update({
    where: { id: userId },
    data: { isForumBanned: false },
  });
}

export async function deleteWarning(prisma: PrismaClient, warningId: string): Promise<void> {
  // Removes a single warning log entry. The user's forum-ban state is independent
  // and stays as-is — lifting a ban is a separate moderation action.
  const warning = await prisma.forumWarning.findUnique({
    where: { id: warningId },
    select: { id: true },
  });
  if (!warning) throw createHttpError(404, "Warning not found");

  await prisma.forumWarning.delete({ where: { id: warningId } });
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
        user: { select: { id: true, fullName: true, isForumBanned: true } },
        admin: { select: { id: true, fullName: true } },
      },
    }),
    prisma.forumWarning.count({ where }),
  ]);
  const warningUserIds = Array.from(new Set(warnings.map((warning) => warning.user.id)));
  const warningCounts = new Map<string, { minor: number; major: number }>();

  await Promise.all(
    warningUserIds.map(async (warningUserId) => {
      const [minor, major] = await Promise.all([
        prisma.forumWarning.count({ where: { userId: warningUserId, level: "MINOR" } }),
        prisma.forumWarning.count({ where: { userId: warningUserId, level: "MAJOR" } }),
      ]);
      warningCounts.set(warningUserId, { minor, major });
    })
  );

  return {
    data: warnings.map((w) => {
      const counts = warningCounts.get(w.user.id) ?? { minor: 0, major: 0 };
      return {
        id: w.id,
        user: { id: w.user.id, name: decryptField(w.user.fullName) },
        admin: { id: w.admin.id, name: decryptField(w.admin.fullName) },
        level: w.level,
        reason: w.reason,
        minorCount: counts.minor,
        majorCount: counts.major,
        // Current forum-ban state of the warned user (drives the FE ban badge).
        isForumBanned: w.user.isForumBanned,
        createdAt: w.createdAt.toISOString(),
      };
    }),
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
