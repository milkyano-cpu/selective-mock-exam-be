import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  BulkUpsertRemindersBody,
  ReminderDateParam,
  UpsertReminderBody,
} from "./student-calendar.schema.js";
import {
  bulkUpsertStudentReminders,
  deleteStudentReminder,
  listStudentReminders,
  upsertStudentReminder,
} from "./student-calendar.service.js";

function getStudentId(request: FastifyRequest) {
  return request.user.sub;
}

export async function listStudentRemindersHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await listStudentReminders(request.server.prisma, getStudentId(request));
  return reply.send({ success: true, message: "Calendar reminders retrieved successfully", data });
}

export async function upsertStudentReminderHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as UpsertReminderBody;
  const data = await upsertStudentReminder(request.server.prisma, getStudentId(request), body);
  return reply.send({ success: true, message: "Calendar reminder saved successfully", data });
}

export async function bulkUpsertStudentRemindersHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as BulkUpsertRemindersBody;
  const data = await bulkUpsertStudentReminders(request.server.prisma, getStudentId(request), body.reminders);
  return reply.send({ success: true, message: "Calendar reminders saved successfully", data });
}

export async function deleteStudentReminderHandler(request: FastifyRequest, reply: FastifyReply) {
  const { date } = request.params as ReminderDateParam;
  await deleteStudentReminder(request.server.prisma, getStudentId(request), date);
  return reply.send({ success: true, message: "Calendar reminder deleted successfully" });
}
