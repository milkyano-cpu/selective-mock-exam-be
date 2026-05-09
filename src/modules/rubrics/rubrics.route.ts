import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { rubricRef } from "./rubrics.schema.js";
import {
  createRubricHandler,
  deactivateRubricHandler,
  getRubricHandler,
  importRubricsHandler,
  listRubricsHandler,
  updateRubricHandler,
} from "./rubrics.controller.js";

export async function rubricRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      tags: ["Rubrics"],
      querystring: rubricRef("listRubricsQuerySchema"),
      response: { 200: rubricRef("paginatedRubricsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: listRubricsHandler,
  });

  fastify.post("/import", {
    schema: {
      tags: ["Rubrics"],
      summary: "Import rubrics from a CSV file",
      consumes: ["multipart/form-data"],
      response: { 200: rubricRef("importRubricsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: importRubricsHandler,
  });

  fastify.post("/", {
    schema: {
      tags: ["Rubrics"],
      body: rubricRef("createRubricBodySchema"),
      response: { 201: rubricRef("singleRubricResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createRubricHandler,
  });

  fastify.get("/:id", {
    schema: {
      tags: ["Rubrics"],
      params: rubricRef("rubricIdParamSchema"),
      response: { 200: rubricRef("singleRubricResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: getRubricHandler,
  });

  fastify.patch("/:id", {
    schema: {
      tags: ["Rubrics"],
      params: rubricRef("rubricIdParamSchema"),
      body: rubricRef("updateRubricBodySchema"),
      response: { 200: rubricRef("singleRubricResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: updateRubricHandler,
  });

  fastify.delete("/:id", {
    schema: {
      tags: ["Rubrics"],
      params: rubricRef("rubricIdParamSchema"),
      response: { 200: rubricRef("actionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deactivateRubricHandler,
  });
}
