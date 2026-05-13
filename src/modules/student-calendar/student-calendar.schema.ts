import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format");

const reminderIdParamSchema = z.object({
  id: z.string().uuid(),
});

const createReminderBodySchema = z.object({
  date: dateKeySchema,
  note: z.string().trim().min(1).max(500),
});

const bulkUpsertRemindersBodySchema = z.object({
  reminders: z.array(createReminderBodySchema).min(1).max(365),
});

const reminderItemSchema = z.object({
  id: z.string(),
  date: z.string(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const remindersListResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(reminderItemSchema),
});

const reminderResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: reminderItemSchema,
});

const bulkReminderResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(reminderItemSchema),
});

const deleteReminderResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type ReminderIdParam = z.infer<typeof reminderIdParamSchema>;
export type CreateReminderBody = z.infer<typeof createReminderBodySchema>;
export type BulkUpsertRemindersBody = z.infer<typeof bulkUpsertRemindersBodySchema>;

export const { schemas: studentCalendarSchemas, $ref: studentCalendarRef } = buildJsonSchemas({
  reminderIdParamSchema,
  createReminderBodySchema,
  bulkUpsertRemindersBodySchema,
  reminderItemSchema,
  remindersListResponseSchema,
  reminderResponseSchema,
  bulkReminderResponseSchema,
  deleteReminderResponseSchema,
});
