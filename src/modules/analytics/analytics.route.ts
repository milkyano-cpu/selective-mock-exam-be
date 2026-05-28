import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { requireStandardStudentFeature } from "../../utils/membership.js";
import { analyticsRef } from "./analytics.schema.js";
import {
  getMyAnalyticsHandler,
  getLeaderboardHandler,
  getStudentAnalyticsHandler,
  getChildrenAnalyticsHandler,
  getChildAnalyticsHandler,
} from "./analytics.controller.js";

export async function analyticsRoutes(fastify: FastifyInstance) {
  const standardAnalytics = requireStandardStudentFeature("Analytics");

  // GET /analytics/me — personal analytics for the logged-in student
  fastify.get("/me", {
    schema: {
      tags: ["Analytics"],
      summary: "Get my performance analytics",
      response: {
        200: analyticsRef("myAnalyticsResponseSchema"),
        403: analyticsRef("tierRequiredResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, standardAnalytics],
    handler: getMyAnalyticsHandler,
  });

  // GET /analytics/leaderboard?period=ALL_TIME
  fastify.get("/leaderboard", {
    schema: {
      tags: ["Analytics"],
      summary: "Get global leaderboard",
      querystring: analyticsRef("leaderboardQuerySchema"),
      response: {
        200: analyticsRef("leaderboardResponseSchema"),
        403: analyticsRef("tierRequiredResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, standardAnalytics],
    handler: getLeaderboardHandler,
  });

  fastify.get("/children", {
    schema: {
      tags: ["Analytics"],
      summary: "List linked students for the logged-in parent (lightweight)",
      response: { 200: analyticsRef("childrenListResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("PARENT")],
    handler: getChildrenAnalyticsHandler,
  });

  fastify.get("/children/:studentId", {
    schema: {
      tags: ["Analytics"],
      summary: "Get a specific linked child's analytics for the logged-in parent",
      params: analyticsRef("studentAnalyticsParamsSchema"),
      response: { 200: analyticsRef("childAnalyticsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("PARENT")],
    handler: getChildAnalyticsHandler,
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
