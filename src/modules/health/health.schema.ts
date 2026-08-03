import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const healthLivenessResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    status: z.string(),
    uptime: z.number(),
    timestamp: z.string(),
    environment: z.string(),
  }),
});

const healthResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    status: z.string(),
    db: z.string(),
    uptime: z.number(),
    timestamp: z.string(),
    environment: z.string(),
  }),
});

const healthDegradedResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    status: z.string(),
    db: z.string(),
    uptime: z.number(),
    timestamp: z.string(),
    environment: z.string(),
  }),
});

export const { schemas: healthSchemas, $ref: healthRef } = buildJsonSchemas({
  healthLivenessResponseSchema,
  healthResponseSchema,
  healthDegradedResponseSchema,
});
