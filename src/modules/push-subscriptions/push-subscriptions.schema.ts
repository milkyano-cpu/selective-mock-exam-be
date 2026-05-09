import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const subscribeBodySchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string(),
      auth: z.string(),
    }),
  }),
  userAgent: z.string().optional(),
});

const unsubscribeBodySchema = z.object({
  endpoint: z.string().url(),
});

const vapidKeyResponseSchema = z.object({
  success: z.boolean(),
  publicKey: z.string().nullable(),
});

const defaultResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type SubscribeBody = z.infer<typeof subscribeBodySchema>;
export type UnsubscribeBody = z.infer<typeof unsubscribeBodySchema>;

export const { schemas: pushSchemas, $ref: pushRef } = buildJsonSchemas({
  subscribeBodySchema,
  unsubscribeBodySchema,
  vapidKeyResponseSchema,
  defaultResponseSchema,
});
