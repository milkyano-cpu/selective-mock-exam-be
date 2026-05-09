import type { FastifyInstance } from "fastify";
import { announcementRef } from "./announcements.schema.js";
import { requireRole } from "../../utils/authz.js";
import {
  createAnnouncementHandler,
  listAnnouncementsHandler,
  announcementsFeedHandler,
  deleteAnnouncementHandler,
} from "./announcements.controller.js";

export async function announcementRoutes(fastify: FastifyInstance) {
  // Admin/Tutor: create broadcast
  fastify.post("/", {
    schema: {
      body: announcementRef("createAnnouncementBodySchema"),
      response: { 201: announcementRef("createAnnouncementResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createAnnouncementHandler,
  });

  // Admin/Tutor: list all announcements (history)
  fastify.get("/", {
    schema: {
      querystring: announcementRef("listAnnouncementsQuerySchema"),
      response: { 200: announcementRef("listAnnouncementsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: listAnnouncementsHandler,
  });

  // Student/Parent: feed of announcements targeted at them
  fastify.get("/feed", {
    schema: {
      querystring: announcementRef("listAnnouncementsQuerySchema"),
      response: { 200: announcementRef("listAnnouncementsResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: announcementsFeedHandler,
  });

  // Admin: delete announcement
  fastify.delete("/:id", {
    schema: {
      params: announcementRef("announcementIdParamSchema"),
      response: { 200: announcementRef("deleteAnnouncementResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteAnnouncementHandler,
  });
}
