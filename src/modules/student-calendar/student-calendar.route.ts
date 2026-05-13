import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { studentCalendarRef } from "./student-calendar.schema.js";
import {
  bulkUpsertStudentRemindersHandler,
  createStudentReminderHandler,
  deleteStudentReminderHandler,
  listStudentRemindersHandler,
} from "./student-calendar.controller.js";

export async function studentCalendarRoutes(fastify: FastifyInstance) {
  fastify.get("/reminders", {
    schema: {
      response: { 200: studentCalendarRef("remindersListResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: listStudentRemindersHandler,
  });

  fastify.post("/reminders", {
    schema: {
      body: studentCalendarRef("createReminderBodySchema"),
      response: { 201: studentCalendarRef("reminderResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: createStudentReminderHandler,
  });

  fastify.post("/reminders/bulk", {
    schema: {
      body: studentCalendarRef("bulkUpsertRemindersBodySchema"),
      response: { 200: studentCalendarRef("bulkReminderResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: bulkUpsertStudentRemindersHandler,
  });

  fastify.delete("/reminders/:id", {
    schema: {
      params: studentCalendarRef("reminderIdParamSchema"),
      response: { 200: studentCalendarRef("deleteReminderResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: deleteStudentReminderHandler,
  });
}
