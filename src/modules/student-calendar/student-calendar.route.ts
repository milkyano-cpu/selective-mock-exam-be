import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { studentCalendarRef } from "./student-calendar.schema.js";
import {
  bulkUpsertStudentRemindersHandler,
  deleteStudentReminderHandler,
  listStudentRemindersHandler,
  upsertStudentReminderHandler,
} from "./student-calendar.controller.js";

export async function studentCalendarRoutes(fastify: FastifyInstance) {
  fastify.get("/reminders", {
    schema: {
      response: { 200: studentCalendarRef("remindersListResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: listStudentRemindersHandler,
  });

  fastify.put("/reminders", {
    schema: {
      body: studentCalendarRef("upsertReminderBodySchema"),
      response: { 200: studentCalendarRef("reminderResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: upsertStudentReminderHandler,
  });

  fastify.post("/reminders/bulk", {
    schema: {
      body: studentCalendarRef("bulkUpsertRemindersBodySchema"),
      response: { 200: studentCalendarRef("bulkReminderResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: bulkUpsertStudentRemindersHandler,
  });

  fastify.delete("/reminders/:date", {
    schema: {
      params: studentCalendarRef("reminderDateParamSchema"),
      response: { 200: studentCalendarRef("deleteReminderResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: deleteStudentReminderHandler,
  });
}
