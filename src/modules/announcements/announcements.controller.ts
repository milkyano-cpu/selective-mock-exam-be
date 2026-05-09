import type { FastifyRequest, FastifyReply } from "fastify";
import type { CreateAnnouncementBody, ListAnnouncementsQuery } from "./announcements.schema.js";
import {
  createAnnouncement,
  sendAnnouncement,
  listAnnouncements,
  listAnnouncementsFeed,
  deleteAnnouncement,
} from "./announcements.service.js";
import { getQueue } from "../../lib/queue.js";

export async function createAnnouncementHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as CreateAnnouncementBody;
  const { announcement, isScheduled } = await createAnnouncement(
    request.server.prisma,
    request.user.sub,
    body
  );

  if (isScheduled) {
    const delay = new Date(body.scheduledAt!).getTime() - Date.now();
    const queue = getQueue("broadcast", request.server.redis);
    await queue.add(
      "send-announcement",
      { announcementId: announcement.id },
      { delay, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );
    request.log.info(
      { announcementId: announcement.id, delay },
      "Announcement scheduled"
    );

    return reply.code(201).send({
      success: true,
      message: "Announcement scheduled successfully",
      data: announcement,
    });
  } else {
    const sentAnnouncement = await sendAnnouncement(
      request.server.prisma,
      announcement.id
    );

    return reply.code(201).send({
      success: true,
      message: "Announcement sent successfully",
      data: sentAnnouncement ?? announcement,
    });
  }
}

export async function listAnnouncementsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListAnnouncementsQuery;
  const result = await listAnnouncements(request.server.prisma, query);

  return reply.send({
    success: true,
    message: "Announcements retrieved",
    ...result,
  });
}

export async function announcementsFeedHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListAnnouncementsQuery;
  const result = await listAnnouncementsFeed(
    request.server.prisma,
    request.user.role,
    query
  );

  return reply.send({
    success: true,
    message: "Announcements feed retrieved",
    ...result,
  });
}

export async function deleteAnnouncementHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as { id: string };
  await deleteAnnouncement(request.server.prisma, id);

  return reply.send({
    success: true,
    message: "Announcement deleted",
  });
}
