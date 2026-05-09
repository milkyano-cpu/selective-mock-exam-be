import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { practiceRef } from "./practice.schema.js";
import {
  getPracticeAccessHandler,
  startPracticeHandler,
  startWeakAreaPracticeHandler,
  getRecommendationsHandler,
  getPracticeSessionHandler,
  submitPracticeHandler,
  listPracticeSessionsHandler,
  createTutorAssignmentHandler,
  listTutorAssignmentsHandler,
} from "./practice.controller.js";

export async function practiceRoutes(fastify: FastifyInstance) {
  fastify.get("/access", {
    schema: {
      tags: ["Practice"],
      summary: "Get the authenticated student's practice access limits",
      response: { 200: practiceRef("practiceAccessResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getPracticeAccessHandler,
  });

  // ── Student: self-selected sessions ──────────────────────────────────────────

  // GET /practice/sessions — list student's practice history (all source types)
  fastify.get("/sessions", {
    schema: {
      tags: ["Practice"],
      summary: "List the authenticated student's practice sessions",
      querystring: practiceRef("listPracticeSessionsQuerySchema"),
      response: { 200: practiceRef("listPracticeSessionsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: listPracticeSessionsHandler,
  });

  // POST /practice/sessions — start a self-selected practice session
  fastify.post("/sessions", {
    schema: {
      tags: ["Practice"],
      summary: "Start a practice session (self-selected or filter by subject, subtopics, history)",
      body: practiceRef("startPracticeBodySchema"),
      response: {
        201: practiceRef("startPracticeResponseSchema"),
        404: practiceRef("practiceErrorResponseSchema"),
        422: practiceRef("practiceErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: startPracticeHandler,
  });

  // POST /practice/sessions/weak-area — start a weak-area practice session
  fastify.post("/sessions/weak-area", {
    schema: {
      tags: ["Practice"],
      summary: "Start a practice session targeting weak topics based on past performance",
      body: practiceRef("startWeakAreaPracticeBodySchema"),
      response: {
        201: practiceRef("startWeakAreaPracticeResponseSchema"),
        422: practiceRef("practiceErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: startWeakAreaPracticeHandler,
  });

  // GET /practice/recommendations — rule-based weak-area topic list
  fastify.get("/recommendations", {
    schema: {
      tags: ["Practice"],
      summary: "Get rule-based weak-area topic recommendations based on past performance",
      querystring: practiceRef("getRecommendationsQuerySchema"),
      response: { 200: practiceRef("getRecommendationsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getRecommendationsHandler,
  });

  // GET /practice/sessions/:sessionId — get session with questions
  fastify.get("/sessions/:sessionId", {
    schema: {
      tags: ["Practice"],
      summary: "Get a practice session (active or completed)",
      params: practiceRef("practiceSessionParamSchema"),
      response: {
        200: practiceRef("getPracticeSessionResponseSchema"),
        403: practiceRef("practiceErrorResponseSchema"),
        404: practiceRef("practiceErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getPracticeSessionHandler,
  });

  // PATCH /practice/sessions/:sessionId/submit — submit answers + complete session
  fastify.patch("/sessions/:sessionId/submit", {
    schema: {
      tags: ["Practice"],
      summary: "Submit all answers for a practice session",
      params: practiceRef("practiceSessionParamSchema"),
      body: practiceRef("submitPracticeBodySchema"),
      response: {
        200: practiceRef("submitPracticeResponseSchema"),
        403: practiceRef("practiceErrorResponseSchema"),
        404: practiceRef("practiceErrorResponseSchema"),
        409: practiceRef("practiceErrorResponseSchema"),
        422: practiceRef("practiceErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: submitPracticeHandler,
  });

  // ── Tutor/Admin: assignment management ───────────────────────────────────────

  // POST /practice/assignments — create an assigned practice for a student
  fastify.post("/assignments", {
    schema: {
      tags: ["Practice"],
      summary: "Create a curated practice assignment for a student (tutor/admin only)",
      body: practiceRef("createAssignmentBodySchema"),
      response: {
        201: practiceRef("createAssignmentResponseSchema"),
        404: practiceRef("practiceErrorResponseSchema"),
        422: practiceRef("practiceErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: createTutorAssignmentHandler,
  });

  // GET /practice/assignments — list assignments created by the tutor
  fastify.get("/assignments", {
    schema: {
      tags: ["Practice"],
      summary: "List practice assignments created by the authenticated tutor/admin",
      querystring: practiceRef("listAssignmentsQuerySchema"),
      response: { 200: practiceRef("listAssignmentsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: listTutorAssignmentsHandler,
  });
}
