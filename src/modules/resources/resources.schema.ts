import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const resourceTypeEnum = z.enum(["FILE", "VIDEO"]);

const createResourceBodySchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(1000).default(""),
  type: resourceTypeEnum,
  videoUrl: z.string().url("Invalid video URL").optional().nullable(),
});

const updateResourceBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
});

const resourceItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  type: resourceTypeEnum,
  fileUrl: z.string().nullable(),
  videoUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  fileSize: z.number().nullable(),
  mimeType: z.string().nullable(),
  uploadedBy: z.string(),
  uploaderName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listResourcesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: resourceTypeEnum.optional(),
  search: z.string().optional(),
});

const listResourcesResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(resourceItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const createResourceResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: resourceItemSchema,
});

const getResourceResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: resourceItemSchema,
});

const updateResourceResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: resourceItemSchema,
});

const deleteResourceResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const resourceIdParamSchema = z.object({
  id: z.string().uuid(),
});

const uploadResourceFileResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: resourceItemSchema,
});

export type CreateResourceInput = z.infer<typeof createResourceBodySchema>;
export type UpdateResourceInput = z.infer<typeof updateResourceBodySchema>;
export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>;

export const { schemas: resourceSchemas, $ref: resourceRef } = buildJsonSchemas({
  createResourceBodySchema,
  createResourceResponseSchema,
  getResourceResponseSchema,
  updateResourceBodySchema,
  updateResourceResponseSchema,
  deleteResourceResponseSchema,
  listResourcesResponseSchema,
  uploadResourceFileResponseSchema,
  resourceIdParamSchema,
  listResourcesQuerySchema,
});
