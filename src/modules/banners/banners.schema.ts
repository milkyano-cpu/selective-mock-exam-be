import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const createBannerBodySchema = z.object({
  imageUrl: z.string().optional().nullable(),
  targetUrl: z.string().url("Invalid target URL").optional().nullable(),
  isActive: z.boolean().default(true),
});

const updateBannerBodySchema = z.object({
  imageUrl: z.string().url("Invalid image URL").optional(),
  targetUrl: z.string().url("Invalid target URL").optional().nullable(),
  isActive: z.boolean().optional(),
});

const bannerItemSchema = z.object({
  id: z.string(),
  imageUrl: z.string(),
  targetUrl: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

const listBannersResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(bannerItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const createBannerResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: bannerItemSchema,
});

const updateBannerResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: bannerItemSchema,
});

const deleteBannerResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const bannerIdParamSchema = z.object({
  id: z.string().uuid(),
});

const getActiveBannersResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(bannerItemSchema),
});

const listBannersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const uploadBannerImageResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: bannerItemSchema,
});

export type CreateBannerInput = z.infer<typeof createBannerBodySchema>;
export type UpdateBannerInput = z.infer<typeof updateBannerBodySchema>;
export type ListBannersQuery = z.infer<typeof listBannersQuerySchema>;

export const { schemas: bannerSchemas, $ref: bannerRef } = buildJsonSchemas({
  createBannerBodySchema,
  createBannerResponseSchema,
  updateBannerBodySchema,
  updateBannerResponseSchema,
  deleteBannerResponseSchema,
  listBannersResponseSchema,
  getActiveBannersResponseSchema,
  uploadBannerImageResponseSchema,
  bannerIdParamSchema,
  listBannersQuerySchema,
});
