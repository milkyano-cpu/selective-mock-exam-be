import type { FastifyInstance } from "fastify";
import { healthRef } from "./health.schema.js";
import { healthCheck } from "./health.controller.js";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", {
    schema: {
      response: { 200: healthRef("healthResponseSchema") },
    },
    handler: healthCheck,
  });
}
