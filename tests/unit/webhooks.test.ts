import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const syncUserTierMock = jest.fn();
const createNotificationMock = jest.fn();

process.env["STRIPE_SECRET_KEY"] = "sk_test_webhooks";
process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret";
process.env["STRIPE_STANDARD_PRICE_ID"] = "price_standard";
process.env["STRIPE_PREMIUM_PRICE_ID"] = "price_premium";

jest.unstable_mockModule("../../src/modules/admin/admin.service.js", () => ({
  syncUserTier: syncUserTierMock,
}));

jest.unstable_mockModule("../../src/lib/notify.js", () => ({
  createNotification: createNotificationMock,
}));

const { stripeWebhookHandler } = await import("../../src/modules/webhooks/webhooks.controller.js");
const { handleStripeEvent } = await import("../../src/modules/webhooks/webhooks.service.js");
const { env } = await import("../../src/config/env.js");

function stripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_123",
    object: "subscription",
    customer: "cus_123",
    status: "active",
    cancel_at_period_end: false,
    metadata: { userId: "user-1", tier: "PREMIUM" },
    items: {
      data: [
        {
          current_period_end: 1778281200,
          price: { id: "price_premium", product: "prod_premium" },
        },
      ],
    },
    ...overrides,
  };
}

function mockPrisma(mappedUserId: string | null = "user-1") {
  return {
    user: {
      findUnique: jest.fn(async () => ({
        id: "user-1",
        email: "email-blind-index",
        emailEncrypted: "not-encrypted-in-test",
        fullName: "not-encrypted-in-test",
        parents: [
          {
            parent: {
              id: "parent-1",
              status: "ACTIVE",
            },
          },
        ],
      })),
    },
    subscription: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => (mappedUserId ? { userId: mappedUserId } : null)),
      upsert: jest.fn(async () => ({})),
    },
    billingInvoice: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({
        id: "billing-invoice-1",
        userId: mappedUserId ?? "user-1",
        stripeInvoiceId: "in_123",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        invoiceNumber: "INV-001",
        status: "paid",
        currency: "aud",
        amountDue: 1900,
        amountPaid: 1900,
        hostedInvoiceUrl: "https://pay.stripe.test/invoice",
        stripeInvoicePdfUrl: "https://pay.stripe.test/invoice.pdf",
        minioObjectKey: null,
        periodStart: null,
        periodEnd: null,
        paidAt: new Date("2026-05-09T00:00:00.000Z"),
        createdAt: new Date("2026-05-09T00:00:00.000Z"),
        updatedAt: new Date("2026-05-09T00:00:00.000Z"),
      })),
      update: jest.fn(async () => ({})),
    },
  };
}

function mockReply() {
  const reply = {
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

function mockLog() {
  return { info: jest.fn(), warn: jest.fn() };
}

function signedHeader(rawBody: string, secret = "whsec_test_secret", timestamp = `${Math.floor(Date.now() / 1000)}`) {
  const payload = `${timestamp}.${rawBody}`;
  const v1 = createHmac("sha256", secret).update(payload).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

describe("webhooks module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncUserTierMock.mockResolvedValue("PREMIUM" as never);
    createNotificationMock.mockResolvedValue({ id: "notification-1" } as never);
  });

  it("ignores unsupported Stripe events without touching subscriptions", async () => {
    const prisma = mockPrisma();

    const result = await handleStripeEvent(prisma as never, {
      type: "customer.created",
      data: { object: { id: "cus_123" } },
    });

    expect(result).toEqual({ handled: false });
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    expect(syncUserTierMock).not.toHaveBeenCalled();
  });

  it("ignores malformed subscription events", async () => {
    const prisma = mockPrisma();

    const result = await handleStripeEvent(prisma as never, {
      type: "customer.subscription.updated",
      data: { object: { object: "subscription" } },
    });

    expect(result).toEqual({ handled: false });
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it("ignores invoice events without a subscription reference", async () => {
    const prisma = mockPrisma();

    const result = await handleStripeEvent(prisma as never, {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_invoice" } },
    });

    expect(result).toEqual({ handled: false });
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it("ignores subscription events when the Stripe customer is not mapped to a user", async () => {
    const prisma = mockPrisma(null);

    const result = await handleStripeEvent(prisma as never, {
      type: "customer.subscription.updated",
      data: { object: stripeSubscription({ metadata: {}, customer: "cus_missing" }) },
    });

    expect(result).toEqual({ handled: false });
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { stripeCustomerId: "cus_missing" },
      orderBy: { currentPeriodEnd: "desc" },
      select: { userId: true },
    });
    expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    expect(syncUserTierMock).not.toHaveBeenCalled();
  });

  it("upserts Stripe subscriptions and syncs the mapped user tier", async () => {
    const prisma = mockPrisma();

    const result = await handleStripeEvent(prisma as never, {
      type: "customer.subscription.updated",
      data: { object: stripeSubscription() },
    });

    expect(result).toEqual({ handled: true });
    expect(prisma.subscription.upsert).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: "sub_123" },
      create: expect.objectContaining({
        userId: "user-1",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_premium",
        stripeProductId: "prod_premium",
        tier: "PREMIUM",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: expect.any(Date),
      }),
      update: expect.objectContaining({
        userId: "user-1",
        stripeCustomerId: "cus_123",
        stripePriceId: "price_premium",
        stripeProductId: "prod_premium",
        tier: "PREMIUM",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: expect.any(Date),
      }),
    });
    expect(syncUserTierMock).toHaveBeenCalledWith(prisma, "user-1");
  });

  it("handles invoice events with expanded subscription data", async () => {
    const prisma = mockPrisma();

    const result = await handleStripeEvent(prisma as never, {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          parent: {
            subscription_details: {
              subscription: stripeSubscription({ id: "sub_invoice", metadata: { userId: "user-invoice", tier: "STANDARD" } }),
            },
          },
        },
      },
    });

    expect(result).toEqual({ handled: true });
    expect(prisma.subscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { stripeSubscriptionId: "sub_invoice" },
      create: expect.objectContaining({ userId: "user-invoice", tier: "STANDARD" }),
      update: expect.objectContaining({ userId: "user-invoice", tier: "STANDARD" }),
    }));
    expect(syncUserTierMock).toHaveBeenCalledWith(prisma, "user-invoice");
  });

  it("notifies the student and active parents when a paid invoice activates the membership tier", async () => {
    const prisma = mockPrisma();

    const result = await handleStripeEvent(prisma as never, {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_123",
          customer: "cus_123",
          status: "paid",
          number: "INV-001",
          currency: "aud",
          amount_due: 1900,
          amount_paid: 1900,
          hosted_invoice_url: "https://pay.stripe.test/invoice",
          invoice_pdf: "https://pay.stripe.test/invoice.pdf",
          status_transitions: { paid_at: 1778281200 },
          parent: {
            subscription_details: {
              subscription: stripeSubscription(),
            },
          },
        },
      },
    });

    expect(result).toEqual({ handled: true });
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
      userId: "user-1",
      type: "BILLING_PAYMENT_SUCCEEDED",
      title: "Payment successful",
      message: "Your payment was successful. Your Aspire membership is now PREMIUM.",
      data: expect.objectContaining({
        href: "/dashboard/billing",
        studentId: "user-1",
        tier: "PREMIUM",
        invoiceId: "billing-invoice-1",
        stripeInvoiceId: "in_123",
        invoiceNumber: "INV-001",
        amountPaid: 1900,
        currency: "aud",
      }),
    }));
    expect(createNotificationMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
      userId: "parent-1",
      type: "BILLING_PAYMENT_SUCCEEDED",
      title: "Payment successful",
      message: "Payment for your student's Aspire membership was successful. Their tier is now PREMIUM.",
    }));
  });

  it("does not send duplicate payment notifications for an already paid invoice", async () => {
    const prisma = mockPrisma();
    prisma.billingInvoice.findUnique.mockResolvedValueOnce({
      status: "paid",
      paidAt: new Date("2026-05-09T00:00:00.000Z"),
    });

    const result = await handleStripeEvent(prisma as never, {
      type: "invoice.paid",
      data: {
        object: {
          id: "in_123",
          customer: "cus_123",
          status: "paid",
          currency: "aud",
          amount_paid: 1900,
          status_transitions: { paid_at: 1778281200 },
          parent: {
            subscription_details: {
              subscription: stripeSubscription(),
            },
          },
        },
      },
    });

    expect(result).toEqual({ handled: true });
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("rejects webhook requests without a Stripe signature header", async () => {
    const request = {
      body: Buffer.from(JSON.stringify({ type: "invoice.payment_succeeded", data: { object: {} } })),
      headers: {},
      server: { prisma: mockPrisma() },
      log: mockLog(),
    };

    await expect(stripeWebhookHandler(request as never, mockReply() as never)).rejects.toMatchObject({
      statusCode: 400,
      message: "Missing stripe-signature header",
    });
  });

  it("rejects webhook requests when the webhook secret is not configured", async () => {
    const originalSecret = env.STRIPE_WEBHOOK_SECRET;
    (env as Record<string, unknown>)["STRIPE_WEBHOOK_SECRET"] = undefined;
    const request = {
      body: Buffer.from(JSON.stringify({ type: "invoice.payment_succeeded", data: { object: {} } })),
      headers: { "stripe-signature": "t=1778194800,v1=abc" },
      server: { prisma: mockPrisma() },
      log: mockLog(),
    };

    try {
      await expect(stripeWebhookHandler(request as never, mockReply() as never)).rejects.toMatchObject({
        statusCode: 503,
        message: "Stripe webhook not configured",
      });
    } finally {
      (env as Record<string, unknown>)["STRIPE_WEBHOOK_SECRET"] = originalSecret;
    }
  });

  it("rejects webhook requests with an invalid Stripe signature", async () => {
    const rawBody = JSON.stringify({ type: "invoice.payment_succeeded", data: { object: {} } });
    const request = {
      body: Buffer.from(rawBody),
      headers: { "stripe-signature": signedHeader(rawBody, "wrong_secret") },
      server: { prisma: mockPrisma() },
      log: mockLog(),
    };

    await expect(stripeWebhookHandler(request as never, mockReply() as never)).rejects.toMatchObject({
      statusCode: 400,
      message: "Webhook signature verification failed",
    });
  });

  it("rejects webhook requests with invalid JSON after signature verification", async () => {
    const rawBody = "{not-json";
    const request = {
      body: Buffer.from(rawBody),
      headers: { "stripe-signature": signedHeader(rawBody) },
      server: { prisma: mockPrisma() },
      log: mockLog(),
    };

    await expect(stripeWebhookHandler(request as never, mockReply() as never)).rejects.toMatchObject({
      statusCode: 400,
      message: "Webhook signature verification failed",
    });
  });

  it("accepts signed Stripe webhooks and logs the handled status", async () => {
    const rawBody = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: stripeSubscription() },
    });
    const request = {
      body: Buffer.from(rawBody),
      headers: { "stripe-signature": signedHeader(rawBody) },
      server: { prisma: mockPrisma("user-1") },
      log: mockLog(),
    };
    const reply = mockReply();

    const response = await stripeWebhookHandler(request as never, reply as never);

    expect(response).toEqual({ received: true, handled: true });
    expect(request.log.info).toHaveBeenCalledWith(
      { type: "customer.subscription.updated", handled: true },
      "Stripe webhook received"
    );
  });
});
