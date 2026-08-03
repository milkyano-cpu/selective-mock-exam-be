import type { FastifyInstance } from "fastify";
import { healthRef } from "./health.schema.js";
import { healthCheck, deepHealthCheck } from "./health.controller.js";

export async function healthRoutes(fastify: FastifyInstance) {
  // Liveness — polled by the container healthcheck. No database access.
  fastify.get("/health", {
    logLevel: "silent",
    schema: {
      response: {
        200: healthRef("healthLivenessResponseSchema"),
      },
    },
    handler: healthCheck,
  });

  // Dependency check — manual/on-demand only. Rate limited so it cannot be used
  // to hammer the database back into a permanently-awake (billed) state.
  fastify.get("/health/deep", {
    logLevel: "silent",
    config: {
      rateLimit: { max: 6, timeWindow: "1 minute" },
    },
    schema: {
      response: {
        200: healthRef("healthResponseSchema"),
        503: healthRef("healthDegradedResponseSchema"),
      },
    },
    handler: deepHealthCheck,
  });
}
