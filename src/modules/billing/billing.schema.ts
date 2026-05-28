import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const billingTierSchema = z.enum(["STANDARD", "PREMIUM"]);

const billingCheckoutBodySchema = z.object({
  tier: billingTierSchema,
});

const parentCheckoutBodySchema = z.object({
  studentId: z.string({ error: "studentId is required" }).uuid("Invalid studentId"),
  tier: billingTierSchema,
});

const parentPortalBodySchema = z.object({
  studentId: z.string({ error: "studentId is required" }).uuid("Invalid studentId"),
});

const billingSubscriptionSchema = z.object({
  id: z.string(),
  tier: z.enum(["STANDARD", "PREMIUM"]),
  status: z.string(),
  currentPeriodEnd: z.string(),
  cancelAtPeriodEnd: z.boolean(),
});

const billingPriceSchema = z.object({
  tier: billingTierSchema,
  unitAmount: z.number().nullable(),
  unitAmountDecimal: z.string().nullable(),
  currency: z.string(),
  interval: z.enum(["day", "week", "month", "year"]).nullable(),
  intervalCount: z.number().nullable(),
});

const billingMeResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    tier: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
    activeSubscription: billingSubscriptionSchema.nullable(),
    subscriptions: z.array(billingSubscriptionSchema),
    prices: z.object({
      STANDARD: billingPriceSchema,
      PREMIUM: billingPriceSchema,
    }),
  }),
});

const billingCheckoutResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    sessionId: z.string(),
    url: z.string(),
  }),
});

const billingPortalResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    url: z.string(),
  }),
});

const billingInvoiceParamsSchema = z.object({
  id: z.string().uuid(),
});

const billingInvoiceSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string(),
  invoiceNumber: z.string().nullable(),
  status: z.string(),
  currency: z.string(),
  amountDue: z.number(),
  amountPaid: z.number(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  downloadAvailable: z.boolean(),
});

const billingInvoicesResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    invoices: z.array(billingInvoiceSchema),
  }),
});

const billingInvoiceDownloadResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    url: z.string(),
    fileName: z.string(),
    source: z.enum(["minio", "stripe_pdf", "stripe_hosted"]),
  }),
});

const billingErrorResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  statusCode: z.number(),
});

const billingParentRefreshResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    refreshed: z.number(),
  }),
});

export type BillingCheckoutBody = z.infer<typeof billingCheckoutBodySchema>;
export type ParentCheckoutBody = z.infer<typeof parentCheckoutBodySchema>;
export type ParentPortalBody = z.infer<typeof parentPortalBodySchema>;
export type BillingTier = z.infer<typeof billingTierSchema>;

export const { schemas: billingSchemas, $ref: billingRef } = buildJsonSchemas({
  billingCheckoutBodySchema,
  parentCheckoutBodySchema,
  parentPortalBodySchema,
  billingMeResponseSchema,
  billingCheckoutResponseSchema,
  billingPortalResponseSchema,
  billingInvoiceParamsSchema,
  billingInvoicesResponseSchema,
  billingInvoiceDownloadResponseSchema,
  billingErrorResponseSchema,
  billingParentRefreshResponseSchema,
});
