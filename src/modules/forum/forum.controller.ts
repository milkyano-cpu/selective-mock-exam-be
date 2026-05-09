import type { FastifyRequest, FastifyReply } from "fastify";
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
  await forumService.deletePost(
    request.server.prisma,
    request.params.postId,
    request.user.sub,
    request.user.role
  );
  return reply.status(204).send();
}

export async function flagPostHandler(
  request: FastifyRequest<{ Params: { postId: string }; Body: FlagPostBody }>,
  reply: FastifyReply
) {
  await forumService.flagPost(
    request.server.prisma,
    request.params.postId,
    request.user.sub,
    request.body
  );
  return reply.send({ success: true, message: "Post flagged for review" });
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
    request.body
  );
  return reply.send({ success: true, message: "Warning issued" });
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
