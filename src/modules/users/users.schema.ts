import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const getMeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    id: z.string(),
    email: z.string(),
    fullName: z.string(),
    role: z.string(),
    status: z.string(),
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

const unauthorizedResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const { schemas: userSchemas, $ref: userRef } = buildJsonSchemas({
  getMeResponseSchema,
  unauthorizedResponseSchema,
});
