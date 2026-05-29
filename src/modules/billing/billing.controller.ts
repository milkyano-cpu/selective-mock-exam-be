import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type {
  BillingCheckoutBody,
  ParentCheckoutBody,
  ParentPortalBody,
} from "./billing.schema.js";
import {
  createCheckoutSession,
  createCustomerPortalSession,
  getBillingOverview,
  getBillingInvoiceDownload,
  listBillingInvoices,
} from "./billing.service.js";
import { env } from "../../config/env.js";
import { assertParentOwnsStudent } from "../../utils/authz.js";
import { createHttpError } from "../../utils/http-error.js";

// Verifies the requesting parent is linked to studentId and the student
// is not soft-deleted. Throws 403 / 404 otherwise.
async function assertParentCanBillForStudent(
  prisma: PrismaClient,
  parentId: string,
  studentId: string
) {
  await assertParentOwnsStudent(prisma, parentId, studentId);
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { id: true, role: true, deletedAt: true },
  });
  if (!student || student.role !== "STUDENT") {
    throw createHttpError(404, "Student not found");
  }
  if (student.deletedAt) {
    throw createHttpError(403, "Student account has been deleted");
  }
}

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

export async function createParentCheckoutSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as ParentCheckoutBody;
  const origin = request.headers.origin || env.APP_URL;
  await assertParentCanBillForStudent(request.server.prisma, request.user.sub, body.studentId);
  const data = await createCheckoutSession(request.server.prisma, body.studentId, body.tier, origin);
  return reply.status(201).send({ success: true, message: "Checkout session created", data });
}

export async function createParentPortalSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as ParentPortalBody;
  const origin = request.headers.origin || env.APP_URL;
  await assertParentCanBillForStudent(request.server.prisma, request.user.sub, body.studentId);
  const data = await createCustomerPortalSession(request.server.prisma, body.studentId, origin);
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
