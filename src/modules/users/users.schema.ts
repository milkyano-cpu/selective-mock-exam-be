import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const profilePhotoPayloadSchema = z.object({
  signedUrl: z.string(),
  originalName: z.string().nullable(),
  mimeType: z.string(),
  size: z.number(),
  updatedAt: z.string(),
  expiresInSeconds: z.number(),
});

const getMeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    id: z.string(),
    email: z.string(),
    fullName: z.string(),
    role: z.string(),
    status: z.string(),
    hasProfilePhoto: z.boolean(),
    profilePhotoUpdatedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    subscriptions: z.array(
      z.object({
        status: z.string(),
        currentPeriodEnd: z.string().nullable(),
      })
    ),
  }),
});

const userUnauthorizedResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

const getMyProfilePhotoResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: profilePhotoPayloadSchema,
});

const uploadMyProfilePhotoResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: profilePhotoPayloadSchema.extend({
    previousPhotoCleanupFailed: z.boolean(),
  }),
});

const userNotFoundResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

export const { schemas: userSchemas, $ref: userRef } = buildJsonSchemas({
  getMeResponseSchema,
  userUnauthorizedResponseSchema,
  getMyProfilePhotoResponseSchema,
  uploadMyProfilePhotoResponseSchema,
  userNotFoundResponseSchema,
});
