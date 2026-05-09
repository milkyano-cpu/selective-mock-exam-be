import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { billingRef } from "./billing.schema.js";
import {
  createCheckoutSessionHandler,
  createCustomerPortalSessionHandler,
  getBillingInvoiceDownloadHandler,
  getBillingOverviewHandler,
  listBillingInvoicesHandler,
} from "./billing.controller.js";

export async function billingRoutes(fastify: FastifyInstance) {
  fastify.get("/me", {
    schema: {
      tags: ["Billing"],
      summary: "Get the authenticated student's billing status",
      response: { 200: billingRef("billingMeResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getBillingOverviewHandler,
  });

  fastify.post("/checkout", {
    schema: {
      tags: ["Billing"],
      summary: "Create a Stripe Checkout Session for a subscription",
      body: billingRef("billingCheckoutBodySchema"),
      response: {
        201: billingRef("billingCheckoutResponseSchema"),
        503: billingRef("billingErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: createCheckoutSessionHandler,
  });

  fastify.post("/portal", {
    schema: {
      tags: ["Billing"],
      summary: "Create a Stripe Customer Portal session",
      response: {
        200: billingRef("billingPortalResponseSchema"),
        404: billingRef("billingErrorResponseSchema"),
        503: billingRef("billingErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: createCustomerPortalSessionHandler,
  });

  fastify.get("/invoices", {
    schema: {
      tags: ["Billing"],
      summary: "List billing invoices for the authenticated student or linked parent",
      response: {
        200: billingRef("billingInvoicesResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT")],
    handler: listBillingInvoicesHandler,
  });

  fastify.get("/invoices/:id/download", {
    schema: {
      tags: ["Billing"],
      summary: "Create a signed billing invoice download URL",
      params: billingRef("billingInvoiceParamsSchema"),
      response: {
        200: billingRef("billingInvoiceDownloadResponseSchema"),
        403: billingRef("billingErrorResponseSchema"),
        404: billingRef("billingErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT", "PARENT")],
    handler: getBillingInvoiceDownloadHandler,
  });
}
