import type { FastifyReply, FastifyRequest } from "fastify";
import type { BillingCheckoutBody } from "./billing.schema.js";
import {
  createCheckoutSession,
  createCustomerPortalSession,
  getBillingOverview,
  getBillingInvoiceDownload,
  listBillingInvoices,
} from "./billing.service.js";
import { env } from "../../config/env.js";

export async function getBillingOverviewHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await getBillingOverview(request.server.prisma, request.user.sub);
  return reply.send({ success: true, message: "Billing status retrieved", data });
}

export async function createCheckoutSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as BillingCheckoutBody;
  const origin = request.headers.origin || env.APP_URL;
  const data = await createCheckoutSession(request.server.prisma, request.user.sub, body.tier, origin);
  return reply.status(201).send({ success: true, message: "Checkout session created", data });
}

export async function createCustomerPortalSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const origin = request.headers.origin || env.APP_URL;
  const data = await createCustomerPortalSession(request.server.prisma, request.user.sub, origin);
  return reply.send({ success: true, message: "Customer portal session created", data });
}

export async function listBillingInvoicesHandler(request: FastifyRequest, reply: FastifyReply) {
  const invoices = await listBillingInvoices(request.server.prisma, request.user);
  return reply.send({ success: true, message: "Billing invoices retrieved", data: { invoices } });
}

export async function getBillingInvoiceDownloadHandler(request: FastifyRequest, reply: FastifyReply) {
  const params = request.params as { id: string };
  const data = await getBillingInvoiceDownload(
    request.server.prisma,
    request.server.storage,
    request.user,
    params.id
  );
  return reply.send({ success: true, message: "Invoice download URL created", data });
}
