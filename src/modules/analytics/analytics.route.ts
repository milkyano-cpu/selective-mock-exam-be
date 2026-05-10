import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { analyticsRef } from "./analytics.schema.js";
import {
  getMyAnalyticsHandler,
  getLeaderboardHandler,
  getStudentAnalyticsHandler,
  getChildrenAnalyticsHandler,
} from "./analytics.controller.js";

export async function analyticsRoutes(fastify: FastifyInstance) {
  // GET /analytics/me — personal analytics for the logged-in student
  fastify.get("/me", {
    schema: {
      tags: ["Analytics"],
      summary: "Get my performance analytics",
      response: { 200: analyticsRef("myAnalyticsResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: getMyAnalyticsHandler,
  });

  // GET /analytics/leaderboard?period=ALL_TIME
  fastify.get("/leaderboard", {
    schema: {
      tags: ["Analytics"],
      summary: "Get global leaderboard",
      querystring: analyticsRef("leaderboardQuerySchema"),
      response: { 200: analyticsRef("leaderboardResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: getLeaderboardHandler,
  });

  fastify.get("/children", {
    schema: {
      tags: ["Analytics"],
      summary: "Get analytics for students linked to the logged-in parent",
      response: { 200: analyticsRef("childrenAnalyticsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("PARENT")],
    handler: getChildrenAnalyticsHandler,
  });

  // GET /analytics/students/:studentId — admin/tutor view of a student
  fastify.get("/students/:studentId", {
    schema: {
      tags: ["Analytics"],
      summary: "Get a specific student's analytics (Admin/Tutor only)",
      params: analyticsRef("studentAnalyticsParamsSchema"),
      response: { 200: analyticsRef("studentAnalyticsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: getStudentAnalyticsHandler,
  });
}
