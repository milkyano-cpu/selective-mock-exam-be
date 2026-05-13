import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  BulkUpsertRemindersBody,
  ReminderIdParam,
  CreateReminderBody,
} from "./student-calendar.schema.js";
import {
  bulkUpsertStudentReminders,
  createStudentReminder,
  deleteStudentReminder,
  listStudentReminders,
} from "./student-calendar.service.js";

function getStudentId(request: FastifyRequest) {
  return request.user.sub;
}

export async function listStudentRemindersHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await listStudentReminders(request.server.prisma, getStudentId(request));
  return reply.send({ success: true, message: "Calendar reminders retrieved successfully", data });
}

export async function createStudentReminderHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateReminderBody;
  const data = await createStudentReminder(request.server.prisma, getStudentId(request), body);
  return reply.status(201).send({ success: true, message: "Calendar reminder saved successfully", data });
}

export async function bulkUpsertStudentRemindersHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as BulkUpsertRemindersBody;
  const data = await bulkUpsertStudentReminders(request.server.prisma, getStudentId(request), body.reminders);
  return reply.send({ success: true, message: "Calendar reminders saved successfully", data });
}

export async function deleteStudentReminderHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as ReminderIdParam;
  await deleteStudentReminder(request.server.prisma, getStudentId(request), id);
  return reply.send({ success: true, message: "Calendar reminder deleted successfully" });
}
