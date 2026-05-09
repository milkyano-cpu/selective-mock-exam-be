import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { countdownRef } from "./countdowns.schema.js";
import {
  activateCountdownHandler,
  createCountdownHandler,
  deleteCountdownHandler,
  getActiveCountdownHandler,
  listCountdownsHandler,
  updateCountdownHandler,
} from "./countdowns.controller.js";

export async function countdownRoutes(fastify: FastifyInstance) {
  fastify.get("/active", {
    schema: {
      response: { 200: countdownRef("activeCountdownResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: getActiveCountdownHandler,
  });

  fastify.get("/", {
    schema: {
      querystring: countdownRef("listCountdownsQuerySchema"),
      response: { 200: countdownRef("listCountdownsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: listCountdownsHandler,
  });

  fastify.post("/", {
    schema: {
      body: countdownRef("createCountdownBodySchema"),
      response: { 201: countdownRef("countdownResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: createCountdownHandler,
  });

  fastify.patch("/:id", {
    schema: {
      params: countdownRef("countdownIdParamSchema"),
      body: countdownRef("updateCountdownBodySchema"),
      response: { 200: countdownRef("countdownResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateCountdownHandler,
  });

  fastify.patch("/:id/activate", {
    schema: {
      params: countdownRef("countdownIdParamSchema"),
      response: { 200: countdownRef("countdownResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: activateCountdownHandler,
  });

  fastify.delete("/:id", {
    schema: {
      params: countdownRef("countdownIdParamSchema"),
      response: { 200: countdownRef("deleteCountdownResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteCountdownHandler,
  });
}
