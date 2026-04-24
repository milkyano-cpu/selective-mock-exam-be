import type { FastifyInstance } from "fastify";
import { adminRef } from "./admin.schema.js";
import {
  createStaff,
  listTutors,
  getTutor,
  updateTutor,
  updateTutorStatus,
  deleteTutor,
} from "./admin.controller.js";
import { requireRole } from "../../utils/authz.js";

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.post("/users", {
    config: {
      rateLimit: { max: 30, timeWindow: "1 minute" },
    },
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

  // ── Tutor CRUD ──────────────────────────────────────────

  fastify.get("/tutors", {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
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
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
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
    config: {
      rateLimit: { max: 30, timeWindow: "1 minute" },
    },
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
    config: {
      rateLimit: { max: 30, timeWindow: "1 minute" },
    },
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
    config: {
      rateLimit: { max: 15, timeWindow: "1 minute" },
    },
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
