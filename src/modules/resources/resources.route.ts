import type { FastifyInstance } from "fastify";
import { resourceRef } from "./resources.schema.js";
import { requireRole } from "../../utils/authz.js";
import {
  listResourcesHandler,
  getResourceHandler,
  previewResourceFileHandler,
  createResourceHandler,
  updateResourceHandler,
  deleteResourceHandler,
  uploadResourceFileHandler,
} from "./resources.controller.js";

export async function resourceRoutes(fastify: FastifyInstance) {
  // All authenticated users can list resources
  fastify.get("/", {
    schema: {
      querystring: resourceRef("listResourcesQuerySchema"),
      response: { 200: resourceRef("listResourcesResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: listResourcesHandler,
  });

  fastify.get("/:id", {
    schema: {
      params: resourceRef("resourceIdParamSchema"),
      response: { 200: resourceRef("getResourceResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: getResourceHandler,
  });

  fastify.get("/:id/preview", {
    schema: {
      params: resourceRef("resourceIdParamSchema"),
    },
    preHandler: [fastify.authenticate],
    handler: previewResourceFileHandler,
  });

  // Admin & Tutor: create resource
  fastify.post("/", {
    schema: {
      body: resourceRef("createResourceBodySchema"),
      response: { 201: resourceRef("createResourceResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createResourceHandler,
  });

  // Admin & Tutor: update resource
  fastify.patch("/:id", {
    schema: {
      params: resourceRef("resourceIdParamSchema"),
      body: resourceRef("updateResourceBodySchema"),
      response: { 200: resourceRef("updateResourceResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: updateResourceHandler,
  });

  // Admin & Tutor: delete resource
  fastify.delete("/:id", {
    schema: {
      params: resourceRef("resourceIdParamSchema"),
      response: { 200: resourceRef("deleteResourceResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deleteResourceHandler,
  });

  // Admin & Tutor: upload file for a resource
  fastify.post("/:id/file", {
    schema: {
      params: resourceRef("resourceIdParamSchema"),
      response: { 200: resourceRef("uploadResourceFileResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: uploadResourceFileHandler,
  });
}
