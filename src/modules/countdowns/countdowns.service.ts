import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";
import type {
  CreateCountdownBody,
  ListCountdownsQuery,
  UpdateCountdownBody,
} from "./countdowns.schema.js";

type CountdownRow = {
  id: string;
  title: string;
  target_at: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type CountdownRecord = {
  id: string;
  title: string;
  targetAt: string;
  isActive: boolean;
  isExpired: boolean;
  createdAt: string;
  updatedAt: string;
};

function serializeCountdown(row: CountdownRow, now = new Date()): CountdownRecord {
  return {
    id: row.id,
    title: row.title,
    targetAt: row.target_at.toISOString(),
    isActive: row.is_active,
    isExpired: row.target_at.getTime() <= now.getTime(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function findCountdownById(prisma: PrismaClient, id: string) {
  const rows = await prisma.$queryRaw<CountdownRow[]>(Prisma.sql`
    SELECT id, title, target_at, is_active, created_at, updated_at
    FROM exam_countdowns
    WHERE id = ${id}
    LIMIT 1
  `);

  return rows[0] ?? null;
}

export async function listCountdowns(prisma: PrismaClient, query: ListCountdownsQuery) {
  const { page, limit } = query;
  const offset = (page - 1) * limit;

  const [items, totalRows] = await Promise.all([
    prisma.$queryRaw<CountdownRow[]>(Prisma.sql`
      SELECT id, title, target_at, is_active, created_at, updated_at
      FROM exam_countdowns
      ORDER BY is_active DESC, target_at ASC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total
      FROM exam_countdowns
    `),
  ]);

  const total = Number(totalRows[0]?.total ?? 0);

  return {
    data: items.map((item) => serializeCountdown(item)),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function createCountdown(prisma: PrismaClient, body: CreateCountdownBody) {
  const targetAt = new Date(body.targetAt);
  if (Number.isNaN(targetAt.getTime())) {
    throw createHttpError(400, "Invalid target date");
  }

  const id = randomUUID();

  const rows = await prisma.$queryRaw<CountdownRow[]>(Prisma.sql`
    INSERT INTO exam_countdowns (id, title, target_at, is_active, created_at, updated_at)
    VALUES (${id}, ${body.title.trim()}, ${targetAt}, false, NOW(), NOW())
    RETURNING id, title, target_at, is_active, created_at, updated_at
  `);

  const created = rows[0];
  if (!created) {
    throw createHttpError(500, "Failed to create countdown");
  }

  return serializeCountdown(created);
}

export async function updateCountdown(prisma: PrismaClient, id: string, body: UpdateCountdownBody) {
  const existing = await findCountdownById(prisma, id);
  if (!existing) {
    throw createHttpError(404, "Countdown not found");
  }

  const nextTitle = body.title !== undefined ? body.title.trim() : existing.title;
  const nextTargetAt = body.targetAt !== undefined ? new Date(body.targetAt) : existing.target_at;

  if (Number.isNaN(nextTargetAt.getTime())) {
    throw createHttpError(400, "Invalid target date");
  }

  const rows = await prisma.$queryRaw<CountdownRow[]>(Prisma.sql`
    UPDATE exam_countdowns
    SET title = ${nextTitle},
        target_at = ${nextTargetAt},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, title, target_at, is_active, created_at, updated_at
  `);

  const updated = rows[0];
  if (!updated) {
    throw createHttpError(500, "Failed to update countdown");
  }

  return serializeCountdown(updated);
}

export async function activateCountdown(prisma: PrismaClient, id: string) {
  const existing = await findCountdownById(prisma, id);
  if (!existing) {
    throw createHttpError(404, "Countdown not found");
  }

  if (existing.target_at.getTime() <= Date.now()) {
    throw createHttpError(400, "Expired countdown cannot be activated");
  }

  await prisma.$transaction([
    prisma.$executeRaw(Prisma.sql`
      UPDATE exam_countdowns
      SET is_active = false,
          updated_at = NOW()
      WHERE is_active = true AND id <> ${id}
    `),
    prisma.$executeRaw(Prisma.sql`
      UPDATE exam_countdowns
      SET is_active = true,
          updated_at = NOW()
      WHERE id = ${id}
    `),
  ]);

  const updated = await findCountdownById(prisma, id);
  if (!updated) {
    throw createHttpError(404, "Countdown not found");
  }

  return serializeCountdown(updated);
}

export async function deleteCountdown(prisma: PrismaClient, id: string) {
  const existing = await findCountdownById(prisma, id);
  if (!existing) {
    throw createHttpError(404, "Countdown not found");
  }

  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM exam_countdowns
    WHERE id = ${id}
  `);
}

export async function getActiveCountdown(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<CountdownRow[]>(Prisma.sql`
    SELECT id, title, target_at, is_active, created_at, updated_at
    FROM exam_countdowns
    WHERE is_active = true
      AND target_at > NOW()
    ORDER BY target_at ASC, updated_at DESC
    LIMIT 1
  `);

  const countdown = rows[0] ?? null;
  return countdown ? serializeCountdown(countdown) : null;
}
