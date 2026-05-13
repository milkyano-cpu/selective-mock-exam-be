import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { aiRubricRef } from "./ai-rubrics.schema.js";
import {
  createAiRubricHandler,
  deactivateAiRubricHandler,
  getAiRubricHandler,
  importAiRubricsHandler,
  listAiRubricsHandler,
  updateAiRubricHandler,
} from "./ai-rubrics.controller.js";

export async function aiRubricRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      tags: ["AI Rubrics"],
      querystring: aiRubricRef("listAiRubricsQuerySchema"),
      response: { 200: aiRubricRef("paginatedAiRubricsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: listAiRubricsHandler,
  });

  fastify.post("/import", {
    schema: {
      tags: ["AI Rubrics"],
      summary: "Import aiRubrics from a CSV file",
      consumes: ["multipart/form-data"],
      response: { 200: aiRubricRef("importAiRubricsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: importAiRubricsHandler,
  });

  fastify.post("/", {
    schema: {
      tags: ["AI Rubrics"],
      body: aiRubricRef("createAiRubricBodySchema"),
      response: { 201: aiRubricRef("singleAiRubricResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createAiRubricHandler,
  });

  fastify.get("/:id", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("aiRubricIdParamSchema"),
      response: { 200: aiRubricRef("singleAiRubricResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: getAiRubricHandler,
  });

  fastify.patch("/:id", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("aiRubricIdParamSchema"),
      body: aiRubricRef("updateAiRubricBodySchema"),
      response: { 200: aiRubricRef("singleAiRubricResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: updateAiRubricHandler,
  });

  fastify.delete("/:id", {
    schema: {
      tags: ["AI Rubrics"],
      params: aiRubricRef("aiRubricIdParamSchema"),
      response: { 200: aiRubricRef("actionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deactivateAiRubricHandler,
  });
}
