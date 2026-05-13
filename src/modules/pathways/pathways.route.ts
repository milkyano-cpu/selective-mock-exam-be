import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { requirePremiumStudentFeature } from "../../utils/membership.js";
import { pathwayRef } from "./pathways.schema.js";
import {
  listPathwaysHandler,
  getPathwayHandler,
  createPathwayHandler,
  deletePathwayHandler,
  addNodeHandler,
  removeNodeHandler,
  reorderNodesHandler,
  startPracticeHandler,
  updateProgressHandler,
} from "./pathways.controller.js";

export async function pathwayRoutes(fastify: FastifyInstance) {
  const premiumPathways = requirePremiumStudentFeature("Pathways");

  // GET /pathways?studentId=xxx
  fastify.get("/", {
    schema: {
      tags: ["Pathways"],
      summary: "List pathways for a student",
      querystring: pathwayRef("listPathwaysQuerySchema"),
      response: { 200: pathwayRef("listPathwaysResponseSchema") },
    },
    preHandler: [fastify.authenticate, premiumPathways],
    handler: listPathwaysHandler,
  });

  // POST /pathways (TUTOR or ADMIN only)
  fastify.post("/", {
    schema: {
      tags: ["Pathways"],
      summary: "Create a learning pathway for a student",
      body: pathwayRef("createPathwayBodySchema"),
      response: {
        201: pathwayRef("createPathwayResponseSchema"),
        403: pathwayRef("pathwayErrorResponseSchema"),
        404: pathwayRef("pathwayErrorResponseSchema"),
        409: pathwayRef("pathwayErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: createPathwayHandler,
  });

  // GET /pathways/:id
  fastify.get("/:id", {
    schema: {
      tags: ["Pathways"],
      summary: "Get full pathway detail with nodes and progress",
      params: pathwayRef("pathwayParamsSchema"),
      response: {
        200: pathwayRef("getPathwayResponseSchema"),
        404: pathwayRef("pathwayErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, premiumPathways],
    handler: getPathwayHandler,
  });

  // DELETE /pathways/:id (TUTOR or ADMIN only)
  fastify.delete("/:id", {
    schema: {
      tags: ["Pathways"],
      summary: "Remove a pathway",
      params: pathwayRef("pathwayParamsSchema"),
      response: { 200: pathwayRef("deletePathwayResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: deletePathwayHandler,
  });

  // POST /pathways/:id/nodes (TUTOR or ADMIN only)
  fastify.post("/:id/nodes", {
    schema: {
      tags: ["Pathways"],
      summary: "Add a topic node to a pathway",
      params: pathwayRef("pathwayParamsSchema"),
      body: pathwayRef("addNodeBodySchema"),
      response: {
        201: pathwayRef("addNodeResponseSchema"),
        404: pathwayRef("pathwayErrorResponseSchema"),
        409: pathwayRef("pathwayErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: addNodeHandler,
  });

  // PUT /pathways/:id/nodes/reorder — register before /:id/nodes/:nodeId to avoid route conflict
  fastify.put("/:id/nodes/reorder", {
    schema: {
      tags: ["Pathways"],
      summary: "Reorder nodes in a pathway",
      params: pathwayRef("pathwayParamsSchema"),
      body: pathwayRef("reorderNodesBodySchema"),
      response: { 200: pathwayRef("reorderNodesResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: reorderNodesHandler,
  });

  // DELETE /pathways/:id/nodes/:nodeId (TUTOR or ADMIN only)
  fastify.delete("/:id/nodes/:nodeId", {
    schema: {
      tags: ["Pathways"],
      summary: "Remove a node from a pathway",
      params: pathwayRef("pathwayNodeParamsSchema"),
      response: { 200: pathwayRef("deletePathwayResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: removeNodeHandler,
  });

  // POST /pathways/:id/nodes/:nodeId/practice (STUDENT only)
  fastify.post("/:id/nodes/:nodeId/practice", {
    schema: {
      tags: ["Pathways"],
      summary: "Start a practice session for an unlocked node",
      params: pathwayRef("pathwayNodeParamsSchema"),
      response: {
        201: pathwayRef("pathwayStartPracticeResponseSchema"),
        403: pathwayRef("pathwayErrorResponseSchema"),
        404: pathwayRef("pathwayErrorResponseSchema"),
        422: pathwayRef("pathwayErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT"), premiumPathways],
    handler: startPracticeHandler,
  });

  // PATCH /pathways/:id/nodes/:nodeId/progress
  fastify.patch("/:id/nodes/:nodeId/progress", {
    schema: {
      tags: ["Pathways"],
      summary: "Update progress for a pathway node",
      params: pathwayRef("pathwayNodeParamsSchema"),
      body: pathwayRef("updateProgressBodySchema"),
      response: {
        200: pathwayRef("updateProgressResponseSchema"),
        404: pathwayRef("pathwayErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, premiumPathways],
    handler: updateProgressHandler,
  });
}
