import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { requireForumAccess, requireForumWriteAccess } from "../../utils/membership.js";
import { forumRef } from "./forum.schema.js";
import {
  listThreadsHandler,
  createThreadHandler,
  getThreadHandler,
  createPostHandler,
  editPostHandler,
  deletePostHandler,
  flagPostHandler,
  adminListFlagsHandler,
  adminReviewFlagHandler,
  adminWarnUserHandler,
  liftForumBanHandler,
  adminListWarningsHandler,
  deleteWarningHandler,
  adminPinThreadHandler,
  adminLockThreadHandler,
  adminDeleteThreadHandler,
  adminApprovePostHandler,
  restorePostHandler,
  adminHidePostHandler,
  adminRemovePostHandler,
  listModeratedPostsHandler,
  listBannedWordsHandler,
  addBannedWordHandler,
  deleteBannedWordHandler,
} from "./forum.controller.js";

export async function forumRoutes(fastify: FastifyInstance) {
  // Forum is Premium-only (read + write). TUTOR/ADMIN bypass the tier check.
  const forumAccess = requireForumAccess();
  const forumWriteAccess = requireForumWriteAccess();

  // ── Premium-only routes (STUDENT + PARENT) ───────────────────────────────

  // GET /forum/threads?segment=STUDENT&page=1
  fastify.get("/threads", {
    schema: { querystring: forumRef("listThreadsQuerySchema") },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT", "ADMIN", "TUTOR"), forumAccess],
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
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT", "ADMIN", "TUTOR"), forumAccess],
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

  // PATCH /forum/posts/:postId (author edits own post)
  fastify.patch("/posts/:postId", {
    schema: {
      params: forumRef("forumPostParamSchema"),
      body: forumRef("editPostBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT", "ADMIN", "TUTOR"), forumAccess],
    handler: editPostHandler,
  });

  // DELETE /forum/posts/:postId (own post or admin)
  fastify.delete("/posts/:postId", {
    schema: { params: forumRef("forumPostParamSchema") },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT", "ADMIN", "TUTOR"), forumAccess],
    handler: deletePostHandler,
  });

  // POST /forum/posts/:postId/flag
  fastify.post("/posts/:postId/flag", {
    schema: {
      params: forumRef("forumPostParamSchema"),
      body: forumRef("flagPostBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT"), forumAccess],
    handler: flagPostHandler,
  });

  // ── Admin-only routes ────────────────────────────────────────────────────

  // GET /forum/admin/flags
  fastify.get("/admin/flags", {
    schema: { querystring: forumRef("adminListFlagsQuerySchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: adminListFlagsHandler,
  });

  // PATCH /forum/admin/flags/:flagId
  fastify.patch("/admin/flags/:flagId", {
    schema: {
      params: forumRef("forumFlagParamSchema"),
      body: forumRef("adminReviewFlagBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: adminReviewFlagHandler,
  });

  // POST /forum/admin/posts/:postId/approve
  fastify.post("/admin/posts/:postId/approve", {
    schema: { params: forumRef("forumPostParamSchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: adminApprovePostHandler,
  });

  // PATCH /forum/admin/posts/:postId/hide (direct hide/unhide from thread detail)
  fastify.patch("/admin/posts/:postId/hide", {
    schema: {
      params: forumRef("forumPostParamSchema"),
      body: forumRef("adminHidePostBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: adminHidePostHandler,
  });

  // PATCH /forum/admin/posts/:postId/remove (direct REMOVED action, ADMIN only)
  fastify.patch("/admin/posts/:postId/remove", {
    schema: { params: forumRef("forumPostParamSchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: adminRemovePostHandler,
  });

  // GET /forum/admin/posts/moderated (hidden/removed posts — Tutor sees HIDDEN, Admin sees both)
  fastify.get("/admin/posts/moderated", {
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: listModeratedPostsHandler,
  });

  // PATCH /forum/admin/posts/:postId/restore (Tutor restores HIDDEN, Admin restores any)
  fastify.patch("/admin/posts/:postId/restore", {
    schema: { params: forumRef("forumPostParamSchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: restorePostHandler,
  });

  // POST /forum/admin/users/:userId/warn
  fastify.post("/admin/users/:userId/warn", {
    schema: {
      params: forumRef("forumUserParamSchema"),
      body: forumRef("adminWarnUserBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: adminWarnUserHandler,
  });

  // DELETE /forum/admin/users/:userId/ban (lift forum ban — ADMIN only)
  fastify.delete("/admin/users/:userId/ban", {
    schema: { params: forumRef("forumUserParamSchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: liftForumBanHandler,
  });

  // GET /forum/admin/warnings
  fastify.get("/admin/warnings", {
    schema: { querystring: forumRef("adminListWarningsQuerySchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: adminListWarningsHandler,
  });

  // DELETE /forum/admin/warnings/:warningId (remove a warning log entry)
  fastify.delete("/admin/warnings/:warningId", {
    schema: { params: forumRef("forumWarningParamSchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deleteWarningHandler,
  });

  // PATCH /forum/admin/threads/:id/pin
  fastify.patch("/admin/threads/:id/pin", {
    schema: {
      params: forumRef("forumThreadParamSchema"),
      body: forumRef("adminPinThreadBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: adminPinThreadHandler,
  });

  // PATCH /forum/admin/threads/:id/lock
  fastify.patch("/admin/threads/:id/lock", {
    schema: {
      params: forumRef("forumThreadParamSchema"),
      body: forumRef("adminLockThreadBodySchema"),
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: adminLockThreadHandler,
  });

  // DELETE /forum/admin/threads/:id
  fastify.delete("/admin/threads/:id", {
    schema: { params: forumRef("forumThreadParamSchema") },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
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
