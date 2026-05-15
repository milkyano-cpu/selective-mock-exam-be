import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const imageTypeEnum = z.enum(["QUESTION", "PASSAGE"]);

const imageSchema = z.object({
  uuid: z.string().uuid(),
  fileName: z.string(),
  imageType: imageTypeEnum,
  refId: z.string().nullable(),
  altText: z.string().nullable(),
  caption: z.string().nullable(),
  url: z.string().nullable(),
  expiredDate: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  passageCount: z.number(),
  questionCount: z.number(),
});

const imageSummarySchema = z.object({
  fileName: z.string(),
  url: z.string().nullable(),
  altText: z.string().nullable(),
  caption: z.string().nullable(),
});

const listImagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

const imageUuidParamSchema = z.object({
  uuid: z.string().uuid(),
});

const updateImageBodySchema = z.object({
  altText: z.string().max(1000).nullable().optional(),
  caption: z.string().max(2000).nullable().optional(),
});

const paginatedImagesResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.array(imageSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const singleImageResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: imageSchema,
});

const deleteImageResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

export const { schemas: imageSchemas, $ref: imageRef } = buildJsonSchemas({
  imageSchema,
  imageSummarySchema,
  listImagesQuerySchema,
  imageUuidParamSchema,
  updateImageBodySchema,
  paginatedImagesResponseSchema,
  singleImageResponseSchema,
  deleteImageResponseSchema,
});

export type ListImagesQuery = z.infer<typeof listImagesQuerySchema>;
export type UpdateImageBody = z.infer<typeof updateImageBodySchema>;
