import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const createAnnouncementBodySchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  target: z.array(z.enum(["STUDENT", "PARENT"])).min(1),
  scheduledAt: z.string().datetime().optional(),
});

const announcementItemSchema = z.object({
  id: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  title: z.string(),
  message: z.string(),
  priority: z.enum(["NORMAL", "URGENT"]),
  target: z.array(z.string()),
  status: z.enum(["SCHEDULED", "SENT"]),
  scheduledAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});

const listAnnouncementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const listAnnouncementsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(announcementItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const createAnnouncementResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: announcementItemSchema,
});

const deleteAnnouncementResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateAnnouncementBody = z.infer<typeof createAnnouncementBodySchema>;
export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsQuerySchema>;

export const { schemas: announcementSchemas, $ref: announcementRef } =
  buildJsonSchemas({
    createAnnouncementBodySchema,
    createAnnouncementResponseSchema,
    listAnnouncementsQuerySchema,
    listAnnouncementsResponseSchema,
    deleteAnnouncementResponseSchema,
    announcementIdParamSchema: idParamSchema,
  });
