import type { FastifyRequest, FastifyReply } from "fastify";
import { constructStripeWebhookEvent, handleStripeEvent } from "./webhooks.service.js";
import { createHttpError } from "../../utils/http-error.js";

export async function stripeWebhookHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const rawBody = request.body as Buffer;
  const sig = request.headers["stripe-signature"] as string | undefined;

  if (!sig) {
    throw createHttpError(400, "Missing stripe-signature header");
  }

  let event: ReturnType<typeof constructStripeWebhookEvent>;
  try {
    event = constructStripeWebhookEvent(rawBody, sig);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
    ) {
      throw error;
    }
    request.log.warn({ error }, "Stripe webhook signature verification failed");
    throw createHttpError(400, "Webhook signature verification failed");
  }

  const result = await handleStripeEvent(request.server.prisma, event, request.server.storage);

  request.log.info({ type: event.type, handled: result.handled }, "Stripe webhook received");

  return reply.send({ received: true, handled: result.handled });
}
