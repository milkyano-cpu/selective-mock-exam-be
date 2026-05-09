import type { FastifyInstance } from "fastify";
import { pushRef } from "./push-subscriptions.schema.js";
import {
  getVapidKeyHandler,
  subscribeHandler,
  unsubscribeHandler,
} from "./push-subscriptions.controller.js";

export async function pushSubscriptionRoutes(fastify: FastifyInstance) {
  // Public route to get the VAPID key
  fastify.get("/vapid-public-key", {
    schema: {
      response: { 200: pushRef("vapidKeyResponseSchema") },
    },
    handler: getVapidKeyHandler,
  });

  // Protected routes for managing subscriptions
  fastify.post("/subscribe", {
    schema: {
      body: pushRef("subscribeBodySchema"),
      response: { 200: pushRef("defaultResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: subscribeHandler,
  });

  fastify.delete("/unsubscribe", {
    schema: {
      body: pushRef("unsubscribeBodySchema"),
      response: { 200: pushRef("defaultResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: unsubscribeHandler,
  });
}
