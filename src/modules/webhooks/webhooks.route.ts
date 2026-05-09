import type { FastifyInstance } from "fastify";
import { stripeWebhookHandler } from "./webhooks.controller.js";

export async function webhookRoutes(fastify: FastifyInstance) {
  // Keep raw body as Buffer so signature verification works correctly.
  // This parser is scoped only to this plugin, so it does not affect other routes.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    }
  );

  fastify.post("/stripe", {
    handler: stripeWebhookHandler,
  });
}
