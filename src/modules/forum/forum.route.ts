import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { requireForumWriteAccess } from "../../utils/membership.js";
import { forumRef } from "./forum.schema.js";
import {
  listThreadsHandler,
  createThreadHandler,
  getThreadHandler,
  createPostHandler,
  deletePostHandler,
  flagPostHandler,
  adminListFlagsHandler,
  adminReviewFlagHandler,
  adminWarnUserHandler,
  adminListWarningsHandler,
  adminPinThreadHandler,
  adminLockThreadHandler,
  adminDeleteThreadHandler,
  adminApprovePostHandler,
  listBannedWordsHandler,
  addBannedWordHandler,
  deleteBannedWordHandler,
} from "./forum.controller.js";

export async function forumRoutes(fastify: FastifyInstance) {
  const forumWriteAccess = requireForumWriteAccess();

  // ── Public-ish routes (STUDENT + PARENT) ─────────────────────────────────

  // GET /forum/threads?segment=STUDENT&page=1
  fastify.get("/threads", {
    schema: { querystring: forumRef("listThreadsQuerySchema") },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT", "ADMIN", "TUTOR")],
    handler: listThreadsHandler,
  });

  // POST /forum/threads?segment=STUDENT
  fastify.post("/threads", {
    schema: {
      querystring: forumRef("createThreadQuerySchema"),
      body: forumRef("createThreadBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT"), forumWriteAccess],
    handler: createThreadHandler,
  });

  // GET /forum/threads/:id
  fastify.get("/threads/:id", {
    schema: {
      params: forumRef("forumThreadParamSchema"),
      querystring: forumRef("listPostsQuerySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT", "ADMIN", "TUTOR")],
    handler: getThreadHandler,
  });

  // POST /forum/threads/:id/posts (reply)
  fastify.post("/threads/:id/posts", {
    schema: {
      params: forumRef("forumThreadParamSchema"),
      body: forumRef("createPostBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT"), forumWriteAccess],
    handler: createPostHandler,
  });

  // DELETE /forum/posts/:postId (own post or admin)
  fastify.delete("/posts/:postId", {
    schema: { params: forumRef("forumPostParamSchema") },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT", "ADMIN"), forumWriteAccess],
    handler: deletePostHandler,
  });

  // POST /forum/posts/:postId/flag
  fastify.post("/posts/:postId/flag", {
    schema: {
      params: forumRef("forumPostParamSchema"),
      body: forumRef("flagPostBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT"), forumWriteAccess],
    handler: flagPostHandler,
  });

  // ── Admin-only routes ────────────────────────────────────────────────────

  // GET /forum/admin/flags
  fastify.get("/admin/flags", {
    schema: { querystring: forumRef("adminListFlagsQuerySchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: adminListFlagsHandler,
  });

  // PATCH /forum/admin/flags/:flagId
  fastify.patch("/admin/flags/:flagId", {
    schema: {
      params: forumRef("forumFlagParamSchema"),
      body: forumRef("adminReviewFlagBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: adminReviewFlagHandler,
  });

  // POST /forum/admin/posts/:postId/approve
  fastify.post("/admin/posts/:postId/approve", {
    schema: { params: forumRef("forumPostParamSchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: adminApprovePostHandler,
  });

  // POST /forum/admin/users/:userId/warn
  fastify.post("/admin/users/:userId/warn", {
    schema: {
      params: forumRef("forumUserParamSchema"),
      body: forumRef("adminWarnUserBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: adminWarnUserHandler,
  });

  // GET /forum/admin/warnings
  fastify.get("/admin/warnings", {
    schema: { querystring: forumRef("adminListWarningsQuerySchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: adminListWarningsHandler,
  });

  // PATCH /forum/admin/threads/:id/pin
  fastify.patch("/admin/threads/:id/pin", {
    schema: {
      params: forumRef("forumThreadParamSchema"),
      body: forumRef("adminPinThreadBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: adminPinThreadHandler,
  });

  // PATCH /forum/admin/threads/:id/lock
  fastify.patch("/admin/threads/:id/lock", {
    schema: {
      params: forumRef("forumThreadParamSchema"),
      body: forumRef("adminLockThreadBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: adminLockThreadHandler,
  });

  // DELETE /forum/admin/threads/:id
  fastify.delete("/admin/threads/:id", {
    schema: { params: forumRef("forumThreadParamSchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: adminDeleteThreadHandler,
  });

  // GET /forum/admin/banned-words
  fastify.get("/admin/banned-words", {
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: listBannedWordsHandler,
  });

  // POST /forum/admin/banned-words
  fastify.post("/admin/banned-words", {
    schema: { body: forumRef("adminBannedWordBodySchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: addBannedWordHandler,
  });

  // DELETE /forum/admin/banned-words/:wordId
  fastify.delete("/admin/banned-words/:wordId", {
    schema: { params: forumRef("forumBannedWordParamSchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteBannedWordHandler,
  });
}
