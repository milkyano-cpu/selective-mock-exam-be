import type { PrismaClient } from "@prisma/client";
import type { CreateAnnouncementBody, ListAnnouncementsQuery } from "./announcements.schema.js";
import { notifyByRoles } from "../../lib/notify.js";
import { decryptField } from "../../utils/field-encryption.js";

const ANNOUNCEMENT_SELECT = {
  id: true,
  authorId: true,
  title: true,
  message: true,
  priority: true,
  target: true,
  status: true,
  scheduledAt: true,
  sentAt: true,
  createdAt: true,
  author: { select: { fullName: true } },
} as const;

type AnnouncementRow = {
  id: string;
  authorId: string;
  title: string;
  message: string;
  priority: "NORMAL" | "URGENT";
  target: string[];
  status: "SCHEDULED" | "SENT";
  scheduledAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  author: { fullName: string };
};

function serialize(row: AnnouncementRow) {
  const { author, ...rest } = row;
  return {
    ...rest,
    authorName: decryptField(author.fullName),
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createAnnouncement(
  prisma: PrismaClient,
  authorId: string,
  body: CreateAnnouncementBody
) {
  const isScheduled = body.scheduledAt && new Date(body.scheduledAt) > new Date();

  const announcement = await prisma.announcement.create({
    data: {
      authorId,
      title: body.title,
      message: body.message,
      priority: body.priority,
      target: body.target,
      status: "SCHEDULED",
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
      sentAt: null,
    },
    select: ANNOUNCEMENT_SELECT,
  });

  return { announcement: serialize(announcement), isScheduled: !!isScheduled };
}

export async function sendAnnouncement(
  prisma: PrismaClient,
  announcementId: string
) {
  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: ANNOUNCEMENT_SELECT,
  });

  if (!announcement) return null;
  if (announcement.status === "SENT") return serialize(announcement);

  await notifyByRoles(prisma, announcement.target, {
    type: "ANNOUNCEMENT",
    title: announcement.title,
    message: announcement.message,
    data: {
      announcementId: announcement.id,
      priority: announcement.priority,
    },
  });

  const updated = await prisma.announcement.update({
    where: { id: announcementId },
    data: { status: "SENT", sentAt: new Date() },
    select: ANNOUNCEMENT_SELECT,
  });

  return serialize(updated);
}

export async function listAnnouncements(
  prisma: PrismaClient,
  query: ListAnnouncementsQuery
) {
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: ANNOUNCEMENT_SELECT,
    }),
    prisma.announcement.count(),
  ]);

  return {
    data: items.map(serialize),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function listAnnouncementsFeed(
  prisma: PrismaClient,
  userRole: string,
  query: ListAnnouncementsQuery
) {
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  const where = {
    status: "SENT" as const,
    target: { has: userRole },
  };

  const [items, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip,
      take: limit,
      select: ANNOUNCEMENT_SELECT,
    }),
    prisma.announcement.count({ where }),
  ]);

  return {
    data: items.map(serialize),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function deleteAnnouncement(
  prisma: PrismaClient,
  id: string
) {
  await prisma.announcement.delete({ where: { id } });
}
