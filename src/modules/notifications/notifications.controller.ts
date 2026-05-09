import type { FastifyRequest, FastifyReply } from "fastify";
import type { ListNotificationsQuery } from "./notifications.schema.js";
import {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "./notifications.service.js";
import { addSseClient, removeSseClient } from "../../lib/sse-manager.js";

export async function listNotificationsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListNotificationsQuery;
  const result = await listNotifications(
    request.server.prisma,
    request.user.sub,
    query
  );

  return reply.send({
    success: true,
    message: "Notifications retrieved",
    ...result,
  });
}

export async function unreadCountHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const count = await getUnreadCount(request.server.prisma, request.user.sub);
  return reply.send({ success: true, count });
}

export async function markAsReadHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as { id: string };
  await markAsRead(request.server.prisma, request.user.sub, id);
  return reply.send({ success: true, message: "Notification marked as read" });
}

export async function markAllAsReadHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const count = await markAllAsRead(request.server.prisma, request.user.sub);
  return reply.send({
    success: true,
    message: `${count} notification(s) marked as read`,
    count,
  });
}

export async function sseHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = request.user.sub;

  reply.hijack();

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  reply.raw.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  addSseClient(userId, reply);

  request.raw.on("close", () => {
    removeSseClient(userId, reply);
  });

  // Keep-alive every 30s
  const keepAlive = setInterval(() => {
    try {
      reply.raw.write(": keep-alive\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 30_000);

  request.raw.on("close", () => {
    clearInterval(keepAlive);
  });
}
