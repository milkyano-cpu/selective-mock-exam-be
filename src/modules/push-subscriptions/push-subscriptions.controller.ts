import type { FastifyRequest, FastifyReply } from "fastify";
import { getVapidPublicKey } from "../../lib/web-push.js";
import { saveSubscription, deleteSubscription } from "./push-subscriptions.service.js";
import type { SubscribeBody, UnsubscribeBody } from "./push-subscriptions.schema.js";

export async function getVapidKeyHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const publicKey = getVapidPublicKey();
  return reply.send({ success: true, publicKey: publicKey || null });
}

export async function subscribeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as SubscribeBody;
  await saveSubscription(request.server.prisma, request.user.sub, body);
  return reply.send({ success: true, message: "Subscribed successfully" });
}

export async function unsubscribeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as UnsubscribeBody;
  await deleteSubscription(request.server.prisma, request.user.sub, body.endpoint);
  return reply.send({ success: true, message: "Unsubscribed successfully" });
}
