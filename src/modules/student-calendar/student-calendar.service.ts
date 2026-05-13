import { randomUUID } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";
import type { CreateReminderBody } from "./student-calendar.schema.js";

type ReminderRow = {
  id: string;
  student_id: string;
  reminder_date: Date;
  note: string;
  created_at: Date;
  updated_at: Date;
};

function parseDateKey(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw createHttpError(400, "Invalid reminder date");
  }
  return parsed;
}

function serializeReminder(row: ReminderRow) {
  return {
    id: row.id,
    date: row.reminder_date.toISOString().slice(0, 10),
    note: row.note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listStudentReminders(prisma: PrismaClient, studentId: string) {
  const rows = await prisma.$queryRaw<ReminderRow[]>(Prisma.sql`
    SELECT id, student_id, reminder_date, note, created_at, updated_at
    FROM student_calendar_reminders
    WHERE student_id = ${studentId}
    ORDER BY reminder_date ASC, created_at ASC
  `);

  return rows.map(serializeReminder);
}

export async function createStudentReminder(
  prisma: PrismaClient,
  studentId: string,
  body: CreateReminderBody
) {
  const reminderDate = parseDateKey(body.date);
  const note = body.note.trim();
  const id = randomUUID();

  const rows = await prisma.$queryRaw<ReminderRow[]>(Prisma.sql`
    INSERT INTO student_calendar_reminders (id, student_id, reminder_date, note, created_at, updated_at)
    VALUES (${id}, ${studentId}, ${reminderDate}::date, ${note}, NOW(), NOW())
    RETURNING id, student_id, reminder_date, note, created_at, updated_at
  `);

  const reminder = rows[0];
  if (!reminder) {
    throw createHttpError(500, "Failed to save reminder");
  }

  return serializeReminder(reminder);
}

export async function bulkUpsertStudentReminders(
  prisma: PrismaClient,
  studentId: string,
  reminders: CreateReminderBody[]
) {
  const saved = [];

  for (const reminder of reminders) {
    saved.push(await createStudentReminder(prisma, studentId, reminder));
  }

  return saved;
}

export async function deleteStudentReminder(prisma: PrismaClient, studentId: string, id: string) {
  const deleted = await prisma.$executeRaw(Prisma.sql`
    DELETE FROM student_calendar_reminders
    WHERE student_id = ${studentId}
      AND id = ${id}
  `);

  if (deleted === 0) {
    throw createHttpError(404, "Reminder not found");
  }
}
