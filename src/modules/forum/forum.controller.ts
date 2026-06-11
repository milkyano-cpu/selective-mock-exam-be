import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  CreateThreadBody,
  CreatePostBody,
  EditPostBody,
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
import * as forumService from "./forum.service.js";

// ── Threads ───────────────────────────────────────────────────────────────────

export async function listThreadsHandler(
  request: FastifyRequest<{ Querystring: ListThreadsQuery }>,
  reply: FastifyReply
) {
  const result = await forumService.listThreads(
    request.server.prisma,
    request.query,
    request.user.sub,
    request.user.role
  );
  return reply.send({ success: true, data: result.data, meta: result.meta });
}

export async function createThreadHandler(
  request: FastifyRequest<{ Body: CreateThreadBody; Querystring: { segment: "STUDENT" | "PARENT" } }>,
  reply: FastifyReply
) {
  const segment = request.query.segment;
  const result = await forumService.createThread(
    request.server.prisma,
    request.user.sub,
    request.user.role,
    segment,
    request.body
  );
  const status = result.underReview ? 202 : 201;
  return reply.status(status).send({
    success: true,
    message: result.underReview
      ? "Your thread is under review and will be visible once approved."
      : "Thread created",
    data: result,
  });
}

export async function getThreadHandler(
  request: FastifyRequest<{ Params: { id: string }; Querystring: ListPostsQuery }>,
  reply: FastifyReply
) {
  const result = await forumService.getThread(
    request.server.prisma,
    request.params.id,
    request.query,
    request.user.sub,
    request.user.role
  );
  return reply.send({ success: true, data: result });
}

export async function createPostHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: CreatePostBody }>,
  reply: FastifyReply
) {
  const result = await forumService.createPost(
    request.server.prisma,
    request.params.id,
    request.user.sub,
    request.user.role,
    request.body
  );
  const status = (result as any).underReview ? 202 : 201;
  return reply.status(status).send({
    success: true,
    message: (result as any).underReview
      ? "Your reply is under review."
      : "Reply posted",
    data: result,
  });
}

export async function deletePostHandler(
  request: FastifyRequest<{ Params: { postId: string } }>,
  reply: FastifyReply
) {
  const { threadDeleted } = await forumService.deletePost(
    request.server.prisma,
    request.params.postId,
    request.user.sub,
    request.user.role
  );
  return reply.send({
    success: true,
    message: threadDeleted ? "Thread deleted" : "Post deleted",
    threadDeleted,
  });
}

export async function editPostHandler(
  request: FastifyRequest<{ Params: { postId: string }; Body: EditPostBody }>,
  reply: FastifyReply
) {
  await forumService.editPost(
    request.server.prisma,
    request.params.postId,
    request.user.sub,
    request.body.content
  );
  return reply.status(204).send();
}

export async function flagPostHandler(
  request: FastifyRequest<{ Params: { postId: string }; Body: FlagPostBody }>,
  reply: FastifyReply
) {
  const { alreadyReported } = await forumService.flagPost(
    request.server.prisma,
    request.params.postId,
    request.user.sub,
    request.body
  );
  return reply.send({
    success: true,
    message: alreadyReported ? "You've already reported this post" : "Post flagged for review",
    alreadyReported,
  });
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function adminListFlagsHandler(
  request: FastifyRequest<{ Querystring: AdminListFlagsQuery }>,
  reply: FastifyReply
) {
  const result = await forumService.adminListFlags(request.server.prisma, request.query);
  return reply.send({ success: true, data: result.data, meta: result.meta });
}

export async function adminReviewFlagHandler(
  request: FastifyRequest<{ Params: { flagId: string }; Body: AdminReviewFlagBody }>,
  reply: FastifyReply
) {
  await forumService.adminReviewFlag(
    request.server.prisma,
    request.params.flagId,
    request.user.sub,
    request.body
  );
  return reply.send({ success: true, message: "Flag reviewed" });
}

export async function adminWarnUserHandler(
  request: FastifyRequest<{ Params: { userId: string }; Body: AdminWarnUserBody }>,
  reply: FastifyReply
) {
  await forumService.adminWarnUser(
    request.server.prisma,
    request.params.userId,
    request.user.sub,
    request.user.role,
    request.body
  );
  return reply.send({ success: true, message: "Warning issued" });
}

export async function liftForumBanHandler(
  request: FastifyRequest<{ Params: { userId: string } }>,
  reply: FastifyReply
) {
  await forumService.liftForumBan(request.server.prisma, request.params.userId);
  return reply.status(204).send();
}

export async function deleteWarningHandler(
  request: FastifyRequest<{ Params: { warningId: string } }>,
  reply: FastifyReply
) {
  await forumService.deleteWarning(request.server.prisma, request.params.warningId);
  return reply.status(204).send();
}

export async function adminListWarningsHandler(
  request: FastifyRequest<{ Querystring: AdminListWarningsQuery }>,
  reply: FastifyReply
) {
  const result = await forumService.adminListWarnings(request.server.prisma, request.query);
  return reply.send({ success: true, data: result.data, meta: result.meta });
}

export async function adminPinThreadHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: AdminPinThreadBody }>,
  reply: FastifyReply
) {
  await forumService.adminPinThread(request.server.prisma, request.params.id, request.body);
  return reply.send({ success: true });
}

export async function adminLockThreadHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: AdminLockThreadBody }>,
  reply: FastifyReply
) {
  await forumService.adminLockThread(request.server.prisma, request.params.id, request.body);
  return reply.send({ success: true });
}

export async function adminDeleteThreadHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  await forumService.adminDeleteThread(request.server.prisma, request.params.id);
  return reply.status(204).send();
}

export async function adminApprovePostHandler(
  request: FastifyRequest<{ Params: { postId: string } }>,
  reply: FastifyReply
) {
  await forumService.adminApprovePost(request.server.prisma, request.params.postId);
  return reply.send({ success: true, message: "Post approved" });
}

export async function restorePostHandler(
  request: FastifyRequest<{ Params: { postId: string } }>,
  reply: FastifyReply
) {
  await forumService.restorePost(
    request.server.prisma,
    request.params.postId,
    request.user.role
  );
  return reply.send({ success: true, message: "Post restored" });
}

export async function adminHidePostHandler(
  request: FastifyRequest<{ Params: { postId: string }; Body: AdminHidePostBody }>,
  reply: FastifyReply
) {
  await forumService.adminHidePost(request.server.prisma, request.params.postId, request.body);
  return reply.send({
    success: true,
    message: request.body.isHidden ? "Post hidden" : "Post unhidden",
  });
}

export async function adminRemovePostHandler(
  request: FastifyRequest<{ Params: { postId: string } }>,
  reply: FastifyReply
) {
  await forumService.adminRemovePost(request.server.prisma, request.params.postId);
  return reply.send({ success: true, message: "Post removed" });
}

export async function listModeratedPostsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const data = await forumService.listModeratedPosts(request.server.prisma, request.user.role);
  return reply.send({ success: true, data });
}

export async function listBannedWordsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const data = await forumService.listBannedWords(request.server.prisma);
  return reply.send({ success: true, data });
}

export async function addBannedWordHandler(
  request: FastifyRequest<{ Body: AdminBannedWordBody }>,
  reply: FastifyReply
) {
  const data = await forumService.addBannedWord(request.server.prisma, request.body);
  return reply.status(201).send({ success: true, data });
}

export async function deleteBannedWordHandler(
  request: FastifyRequest<{ Params: { wordId: string } }>,
  reply: FastifyReply
) {
  await forumService.deleteBannedWord(request.server.prisma, request.params.wordId);
  return reply.status(204).send();
}
