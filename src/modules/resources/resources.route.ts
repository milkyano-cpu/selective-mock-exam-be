import type { FastifyInstance } from "fastify";
import { resourceRef } from "./resources.schema.js";
import { requireRole } from "../../utils/authz.js";
import { requirePremiumStudentFeature } from "../../utils/membership.js";
import {
  listResourcesHandler,
  getResourceHandler,
  previewResourceFileHandler,
  getResourceStreamUrlHandler,
  createResourceHandler,
  updateResourceHandler,
  deleteResourceHandler,
  uploadResourceFileHandler,
} from "./resources.controller.js";

export async function resourceRoutes(fastify: FastifyInstance) {
  // Resources are a Premium-only feature for students. TUTOR/ADMIN keep full
  // access; PARENT has no membership tier and must be blocked from every
  // content-serving GET route. requireRole 403s anyone not listed (so PARENT
  // is rejected), and requirePremiumStudentFeature returns early for non-STUDENT
  // roles, then tier-gates STUDENTs to PREMIUM.
  const premiumResources = requirePremiumStudentFeature("Resources");
  const resourceViewers = requireRole("STUDENT", "TUTOR", "ADMIN");
  const viewerGuards = [fastify.authenticate, resourceViewers, premiumResources];

  // Premium students (and TUTOR/ADMIN) can list resources
  fastify.get("/", {
    schema: {
      querystring: resourceRef("listResourcesQuerySchema"),
      response: { 200: resourceRef("listResourcesResponseSchema") },
    },
    preHandler: viewerGuards,
    handler: listResourcesHandler,
  });

  fastify.get("/:id", {
    schema: {
      params: resourceRef("resourceIdParamSchema"),
      response: { 200: resourceRef("getResourceResponseSchema") },
    },
    preHandler: viewerGuards,
    handler: getResourceHandler,
  });

  fastify.get("/:id/preview", {
    schema: {
      params: resourceRef("resourceIdParamSchema"),
    },
    preHandler: viewerGuards,
    handler: previewResourceFileHandler,
  });

  fastify.get("/:id/stream-url", {
    schema: {
      params: resourceRef("resourceIdParamSchema"),
    },
    preHandler: viewerGuards,
    handler: getResourceStreamUrlHandler,
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
