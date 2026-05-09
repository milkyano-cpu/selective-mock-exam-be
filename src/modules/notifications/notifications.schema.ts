import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z.coerce.boolean().optional(),
});

const notificationItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.string(),
  title: z.string(),
  message: z.string(),
  data: z.any().nullable(),
  isRead: z.boolean(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

const listNotificationsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(notificationItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const unreadCountResponseSchema = z.object({
  success: z.boolean(),
  count: z.number(),
});

const markReadParamsSchema = z.object({
  id: z.string().uuid(),
});

const markReadResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const markAllReadResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  count: z.number(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const { schemas: notificationSchemas, $ref: notificationRef } =
  buildJsonSchemas({
    listNotificationsQuerySchema,
    listNotificationsResponseSchema,
    unreadCountResponseSchema,
    markReadParamsSchema,
    markReadResponseSchema,
    markAllReadResponseSchema,
  });
