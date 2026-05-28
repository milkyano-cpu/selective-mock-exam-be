import type { FastifyInstance } from "fastify";
import { adminRef } from "./admin.schema.js";
import {
  createStaff,
  listUsersHandler,
  syncAllTiersHandler,
  listTutors,
  getTutor,
  updateTutor,
  updateTutorStatus,
  deleteTutor,
  deleteUserHandler,
  getAdminStatsHandler,
  updateUserHandler,
  updateUserStatusHandler,
} from "./admin.controller.js";
import { requireRole } from "../../utils/authz.js";

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.get("/stats", {
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: getAdminStatsHandler,
  });

  fastify.get("/users", {
    schema: {
      querystring: adminRef("listUsersQuerySchema"),
      response: { 200: adminRef("listUsersResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: listUsersHandler,
  });

  fastify.post("/users/sync-tiers", {
    schema: {
      response: { 200: adminRef("syncTiersResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: syncAllTiersHandler,
  });

  fastify.post("/users", {
    schema: {
      body: adminRef("createStaffBodySchema"),
      response: {
        201: adminRef("createStaffResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: createStaff,
  });

  fastify.put("/users/:id", {
    schema: {
      tags: ["Admin"],
      summary: "Update a staff (TUTOR or ADMIN) profile",
      params: adminRef("userParamsSchema"),
      body: adminRef("updateTutorBodySchema"),
      response: {
        200: adminRef("updateUserResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
        404: adminRef("notFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateUserHandler,
  });

  fastify.patch("/users/:id/status", {
    schema: {
      tags: ["Admin"],
      summary: "Change a staff (TUTOR or ADMIN) account status",
      params: adminRef("userParamsSchema"),
      body: adminRef("updateTutorStatusBodySchema"),
      response: {
        200: adminRef("updateUserStatusResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
        404: adminRef("notFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateUserStatusHandler,
  });

  fastify.delete("/users/:id", {
    schema: {
      tags: ["Admin"],
      summary: "Soft-delete any user by ID",
      response: {
        200: adminRef("deleteUserResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
        404: adminRef("notFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteUserHandler,
  });

  // ── Tutor CRUD ──────────────────────────────────────────

  fastify.get("/tutors", {
    schema: {
      querystring: adminRef("listTutorsQuerySchema"),
      response: {
        200: adminRef("listTutorsResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: listTutors,
  });

  fastify.get("/tutors/:id", {
    schema: {
      params: adminRef("tutorParamsSchema"),
      response: {
        200: adminRef("getTutorResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
        404: adminRef("notFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: getTutor,
  });

  fastify.put("/tutors/:id", {
    schema: {
      params: adminRef("tutorParamsSchema"),
      body: adminRef("updateTutorBodySchema"),
      response: {
        200: adminRef("updateTutorResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
        404: adminRef("notFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateTutor,
  });

  fastify.patch("/tutors/:id/status", {
    schema: {
      params: adminRef("tutorParamsSchema"),
      body: adminRef("updateTutorStatusBodySchema"),
      response: {
        200: adminRef("updateTutorStatusResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
        404: adminRef("notFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateTutorStatus,
  });

  fastify.delete("/tutors/:id", {
    schema: {
      params: adminRef("tutorParamsSchema"),
      response: {
        200: adminRef("deleteTutorResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
        404: adminRef("notFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteTutor,
  });
}
