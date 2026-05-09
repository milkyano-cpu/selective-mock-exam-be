import type { FastifyInstance } from "fastify";
import { notificationRef } from "./notifications.schema.js";
import {
  listNotificationsHandler,
  unreadCountHandler,
  markAsReadHandler,
  markAllAsReadHandler,
  sseHandler,
} from "./notifications.controller.js";

export async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      querystring: notificationRef("listNotificationsQuerySchema"),
      response: { 200: notificationRef("listNotificationsResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: listNotificationsHandler,
  });

  fastify.get("/unread-count", {
    schema: {
      response: { 200: notificationRef("unreadCountResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: unreadCountHandler,
  });

  fastify.get("/sse", {
    preHandler: [fastify.authenticate],
    handler: sseHandler,
  });

  fastify.patch("/:id/read", {
    schema: {
      params: notificationRef("markReadParamsSchema"),
      response: { 200: notificationRef("markReadResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: markAsReadHandler,
  });

  fastify.patch("/read-all", {
    schema: {
      response: { 200: notificationRef("markAllReadResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: markAllAsReadHandler,
  });
}
