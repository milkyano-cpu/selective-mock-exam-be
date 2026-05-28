import Stripe from "stripe";
import type { PrismaClient, Tier } from "@prisma/client";
import { env } from "../../config/env.js";
import { syncUserTier } from "../admin/admin.service.js";
import { createHttpError } from "../../utils/http-error.js";
import { assertCanAccessStudent } from "../../utils/authz.js";
import { decryptUser } from "../../utils/user-crypto.js";
import type { ObjectStorage } from "../../lib/object-storage.js";
import { createNotification } from "../../lib/notify.js";
import type { BillingTier } from "./billing.schema.js";

const STRIPE_API_VERSION = "2026-02-25.clover";
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const DISPLAY_CURRENCY = "usd";

type SubscriptionWithLegacyPeriod = Stripe.Subscription & {
  current_period_end?: number | null;
};

type BillingPriceSummary = {
  tier: BillingTier;
  unitAmount: number | null;
  unitAmountDecimal: string | null;
  currency: string;
  interval: Stripe.Price.Recurring.Interval | null;
  intervalCount: number | null;
};

type StripeSubscriptionSyncResult =
  | { handled: false }
  | {
      handled: true;
      userId: string;
      tier: Tier;
      subscriptionStatus: string;
    };

type StripeInvoiceUpsertResult =
  | { handled: false; pdfStored: false; paidNow: false }
  | {
      handled: true;
      pdfStored: boolean;
      paidNow: boolean;
      invoiceId: string;
      stripeInvoiceId: string;
      invoiceNumber: string | null;
      amountPaid: number;
      currency: string;
    };

let stripeClient: Stripe | null = null;

function getStripe() {
  if (!env.STRIPE_SECRET_KEY) {
    throw createHttpError(503, "Stripe is not configured");
  }

  stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY, {
    // @ts-expect-error stripe-node types only expose the package's latest API version.
    apiVersion: STRIPE_API_VERSION,
  });

  return stripeClient;
}

function getPriceIdForTier(tier: BillingTier) {
  const priceId = tier === "STANDARD" ? env.STRIPE_STANDARD_PRICE_ID : env.STRIPE_PREMIUM_PRICE_ID;
  if (!priceId) {
    throw createHttpError(503, `${tier} Stripe price is not configured`);
  }
  return priceId;
}

function getOptionalPriceIdForTier(tier: BillingTier) {
  return tier === "STANDARD" ? env.STRIPE_STANDARD_PRICE_ID : env.STRIPE_PREMIUM_PRICE_ID;
}

function fallbackPriceSummary(tier: BillingTier): BillingPriceSummary {
  return {
    tier,
    unitAmount: null,
    unitAmountDecimal: null,
    currency: DISPLAY_CURRENCY,
    interval: "month",
    intervalCount: 1,
  };
}

function formatPriceSummary(tier: BillingTier, price: Stripe.Price): BillingPriceSummary {
  return {
    tier,
    unitAmount: price.unit_amount,
    unitAmountDecimal: price.unit_amount_decimal?.toString() ?? null,
    currency: price.currency,
    interval: price.recurring?.interval ?? null,
    intervalCount: price.recurring?.interval_count ?? null,
  };
}

async function getPriceSummary(tier: BillingTier): Promise<BillingPriceSummary> {
  const priceId = getOptionalPriceIdForTier(tier);
  if (!env.STRIPE_SECRET_KEY || !priceId) {
    return fallbackPriceSummary(tier);
  }

  try {
    const price = await getStripe().prices.retrieve(priceId);
    return formatPriceSummary(tier, price);
  } catch {
    return fallbackPriceSummary(tier);
  }
}

async function getBillingPrices() {
  const [standard, premium] = await Promise.all([
    getPriceSummary("STANDARD"),
    getPriceSummary("PREMIUM"),
  ]);

  return {
    STANDARD: standard,
    PREMIUM: premium,
  };
}

function resolveTierFromPriceId(priceId: string | null | undefined): BillingTier {
  if (priceId && priceId === env.STRIPE_PREMIUM_PRICE_ID) return "PREMIUM";
  return "STANDARD";
}

function normalizeTier(value: unknown, priceId?: string | null): BillingTier {
  if (value === "PREMIUM") return "PREMIUM";
  if (value === "STANDARD") return "STANDARD";
  return resolveTierFromPriceId(priceId);
}

function getProductId(price: Stripe.Price | null | undefined) {
  const product = price?.product;
  if (!product) return null;
  return typeof product === "string" ? product : product.id;
}

function getCurrentPeriodEnd(subscription: Stripe.Subscription) {
  const legacyPeriodEnd = (subscription as SubscriptionWithLegacyPeriod).current_period_end;
  const itemPeriodEnd = subscription.items.data[0]?.current_period_end;
  return legacyPeriodEnd ?? itemPeriodEnd ?? Math.floor(Date.now() / 1000);
}

function timestampToDate(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

function formatSubscription(sub: {
  id: string;
  tier: Tier;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}) {
  return {
    id: sub.id,
    tier: sub.tier as BillingTier,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
}

function formatInvoice(invoice: {
  id: string;
  userId: string;
  invoiceNumber: string | null;
  status: string;
  currency: string;
  amountDue: number;
  amountPaid: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  hostedInvoiceUrl: string | null;
  stripeInvoicePdfUrl: string | null;
  minioObjectKey: string | null;
  user: {
    id: string;
    email: string;
    emailEncrypted: string;
    fullName: string;
  };
}) {
  const student = decryptUser(invoice.user);

  return {
    id: invoice.id,
    studentId: invoice.userId,
    studentName: student.fullName,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency,
    amountDue: invoice.amountDue,
    amountPaid: invoice.amountPaid,
    periodStart: invoice.periodStart?.toISOString() ?? null,
    periodEnd: invoice.periodEnd?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    downloadAvailable: Boolean(invoice.minioObjectKey || invoice.stripeInvoicePdfUrl || invoice.hostedInvoiceUrl),
  };
}

function hasInvoiceBeenPaid(invoice: Stripe.Invoice) {
  return invoice.status === "paid" || typeof invoice.status_transitions?.paid_at === "number";
}

function wasStoredInvoicePaid(invoice: { status: string; paidAt: Date | null } | null) {
  return invoice?.status === "paid" || Boolean(invoice?.paidAt);
}

function getStudentDisplayName(student: {
  email: string;
  emailEncrypted: string;
  fullName: string;
}) {
  try {
    return decryptUser(student).fullName;
  } catch {
    return "your student";
  }
}

async function notifyMembershipPaymentSucceeded(
  prisma: PrismaClient,
  input: {
    userId: string;
    tier: Tier;
    invoiceId: string;
    stripeInvoiceId: string;
    invoiceNumber: string | null;
    amountPaid: number;
    currency: string;
  }
) {
  if (input.tier === "BASIC") return;

  const student = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      email: true,
      emailEncrypted: true,
      fullName: true,
      parents: {
        select: {
          parent: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!student) return;

  const studentName = getStudentDisplayName(student);
  const parentIds = student.parents
    .map((relation) => relation.parent)
    .filter((parent) => parent.status === "ACTIVE")
    .map((parent) => parent.id);

  const data = {
    href: "/dashboard/billing",
    studentId: input.userId,
    tier: input.tier,
    invoiceId: input.invoiceId,
    stripeInvoiceId: input.stripeInvoiceId,
    invoiceNumber: input.invoiceNumber,
    amountPaid: input.amountPaid,
    currency: input.currency,
  };

  await createNotification(prisma, {
    userId: input.userId,
    type: "BILLING_PAYMENT_SUCCEEDED",
    title: "Payment successful",
    message: `Your payment was successful. Your Aspire membership is now ${input.tier}.`,
    data,
  });

  await Promise.all(
    [...new Set(parentIds)].map((parentId) =>
      createNotification(prisma, {
        userId: parentId,
        type: "BILLING_PAYMENT_SUCCEEDED",
        title: "Payment successful",
        message: `Payment for ${studentName}'s Aspire membership was successful. Their tier is now ${input.tier}.`,
        data,
      })
    )
  );
}

async function getStudentIdsForBillingActor(
  prisma: PrismaClient,
  actor: { sub: string; role: string }
) {
  if (actor.role === "STUDENT") return [actor.sub];

  if (actor.role === "PARENT") {
    const relations = await prisma.parentStudentRelation.findMany({
      where: { parentId: actor.sub },
      select: { studentId: true },
    });
    return relations.map((relation) => relation.studentId);
  }

  throw createHttpError(403, "Forbidden");
}

export async function getBillingOverview(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      tier: true,
      subscriptions: {
        orderBy: { currentPeriodEnd: "desc" },
        select: {
          id: true,
          tier: true,
          status: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
        },
      },
    },
  });

  if (!user || user.role !== "STUDENT") {
    throw createHttpError(404, "Student not found");
  }

  const now = new Date();
  const subscriptions = user.subscriptions.map(formatSubscription);
  const activeSubscription = user.subscriptions.find(
    (sub) => ACTIVE_STATUSES.has(sub.status) && sub.currentPeriodEnd > now
  );
  const prices = await getBillingPrices();

  return {
    tier: user.tier,
    activeSubscription: activeSubscription ? formatSubscription(activeSubscription) : null,
    subscriptions,
    prices,
  };
}

async function getOrCreateCustomerId(prisma: PrismaClient, stripe: Stripe, userId: string) {
  const existing = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { currentPeriodEnd: "desc" },
    select: { stripeCustomerId: true },
  });

  if (existing?.stripeCustomerId) {
    return existing.stripeCustomerId;
  }

  const rawUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      email: true,
      emailEncrypted: true,
      fullName: true,
    },
  });

  if (!rawUser || rawUser.role !== "STUDENT") {
    throw createHttpError(404, "Student not found");
  }

  const user = decryptUser(rawUser);
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.fullName,
    metadata: { userId },
  });

  return customer.id;
}

export async function createCheckoutSession(
  prisma: PrismaClient,
  userId: string,
  tier: BillingTier,
  origin: string = env.APP_URL
) {
  const stripe = getStripe();
  const priceId = getPriceIdForTier(tier);
  const customerId = await getOrCreateCustomerId(prisma, stripe, userId);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard/billing?checkout=success`,
    cancel_url: `${origin}/dashboard/billing?checkout=cancelled`,
    client_reference_id: userId,
    metadata: { userId, tier },
    subscription_data: {
      metadata: { userId, tier },
    },
  });

  if (!session.url) {
    throw createHttpError(502, "Stripe did not return a checkout URL");
  }

  return { sessionId: session.id, url: session.url };
}

export async function createCustomerPortalSession(
  prisma: PrismaClient,
  userId: string,
  origin: string = env.APP_URL
) {
  const stripe = getStripe();
  const existing = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { currentPeriodEnd: "desc" },
    select: { stripeCustomerId: true },
  });

  if (!existing?.stripeCustomerId) {
    throw createHttpError(404, "No Stripe subscription found for this student");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: existing.stripeCustomerId,
    return_url: `${origin}/dashboard/billing`,
  });

  return { url: session.url };
}

export async function listBillingInvoices(
  prisma: PrismaClient,
  actor: { sub: string; role: string }
) {
  const studentIds = await getStudentIdsForBillingActor(prisma, actor);
  if (studentIds.length === 0) return [];

  const invoices = await prisma.billingInvoice.findMany({
    where: { userId: { in: studentIds } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          emailEncrypted: true,
          fullName: true,
        },
      },
    },
  });

  return invoices.map(formatInvoice);
}

export async function getBillingInvoiceDownload(
  prisma: PrismaClient,
  storage: ObjectStorage,
  actor: { sub: string; role: string },
  invoiceId: string
) {
  const invoice = await prisma.billingInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      userId: true,
      invoiceNumber: true,
      stripeInvoiceId: true,
      minioObjectKey: true,
      stripeInvoicePdfUrl: true,
      hostedInvoiceUrl: true,
    },
  });

  if (!invoice) {
    throw createHttpError(404, "Invoice not found");
  }

  await assertCanAccessStudent(prisma, actor, invoice.userId);

  const fileName = `${invoice.invoiceNumber ?? invoice.stripeInvoiceId}.pdf`;
  if (invoice.minioObjectKey) {
    return {
      url: await storage.getInvoicePdfSignedUrl(invoice.minioObjectKey),
      fileName,
      source: "minio" as const,
    };
  }

  const url = invoice.stripeInvoicePdfUrl ?? invoice.hostedInvoiceUrl;
  if (!url) {
    throw createHttpError(404, "Invoice PDF is not available yet");
  }

  return {
    url,
    fileName,
    source: invoice.stripeInvoicePdfUrl ? "stripe_pdf" as const : "stripe_hosted" as const,
  };
}

function getSubscriptionMetadataUserId(subscription: Stripe.Subscription | null | undefined) {
  return typeof subscription?.metadata?.userId === "string" ? subscription.metadata.userId : null;
}

async function resolveWebhookUserId(
  prisma: PrismaClient,
  subscription: Stripe.Subscription,
  fallbackUserId?: string | null
) {
  const metadataUserId = typeof subscription.metadata?.userId === "string"
    ? subscription.metadata.userId
    : null;
  if (metadataUserId) return metadataUserId;
  if (fallbackUserId) return fallbackUserId;

  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
    select: { userId: true },
  });
  if (existing) return existing.userId;

  if (!subscription.customer) return null;

  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
  const byCustomer = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    orderBy: { currentPeriodEnd: "desc" },
    select: { userId: true },
  });

  return byCustomer?.userId ?? null;
}

export async function upsertStripeSubscription(
  prisma: PrismaClient,
  subscription: Stripe.Subscription,
  fallbackUserId?: string | null
): Promise<StripeSubscriptionSyncResult> {
  if (!subscription.id || !subscription.customer) {
    return { handled: false };
  }

  const userId = await resolveWebhookUserId(prisma, subscription, fallbackUserId);
  if (!userId) {
    return { handled: false };
  }

  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const productId = getProductId(item?.price);
  const tier = normalizeTier(subscription.metadata?.tier, priceId);
  const currentPeriodEnd = new Date(getCurrentPeriodEnd(subscription) * 1000);

  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: subscription.id },
    create: {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      stripeProductId: productId,
      tier,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd,
    },
    update: {
      userId,
      stripeCustomerId: customerId,
      stripePriceId: priceId,
      stripeProductId: productId,
      tier,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd,
    },
  });

  const syncedTier = await syncUserTier(prisma, userId);
  return {
    handled: true,
    userId,
    tier: syncedTier,
    subscriptionStatus: subscription.status,
  };
}

async function retrieveSubscription(subscriptionId: string) {
  return getStripe().subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });
}

function getSubscriptionFromInvoice(invoice: Stripe.Invoice) {
  const legacySubscription = (invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }).subscription;
  if (typeof legacySubscription === "string") return legacySubscription;
  if (legacySubscription && typeof legacySubscription === "object") return legacySubscription;

  const parentSubscription = (
    invoice as Stripe.Invoice & {
      parent?: { subscription_details?: { subscription?: string | Stripe.Subscription | null } | null } | null;
    }
  ).parent?.subscription_details?.subscription;

  if (typeof parentSubscription === "string") return parentSubscription;
  if (parentSubscription && typeof parentSubscription === "object") return parentSubscription;
  return null;
}

function getInvoiceCustomerId(invoice: Stripe.Invoice) {
  const customer = invoice.customer;
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const subscription = getSubscriptionFromInvoice(invoice);
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

async function resolveInvoiceUserId(
  prisma: PrismaClient,
  invoice: Stripe.Invoice,
  fallbackUserId?: string | null
) {
  if (fallbackUserId) return fallbackUserId;

  const metadataUserId = typeof invoice.metadata?.userId === "string"
    ? invoice.metadata.userId
    : null;
  if (metadataUserId) return metadataUserId;

  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (subscriptionId) {
    const bySubscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      select: { userId: true },
    });
    if (bySubscription) return bySubscription.userId;
  }

  const customerId = getInvoiceCustomerId(invoice);
  if (!customerId) return null;

  const byCustomer = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    orderBy: { currentPeriodEnd: "desc" },
    select: { userId: true },
  });

  return byCustomer?.userId ?? null;
}

async function mirrorInvoicePdfToStorage(
  storage: ObjectStorage,
  userId: string,
  invoiceId: string,
  invoicePdfUrl: string
) {
  const response = await fetch(invoicePdfUrl);
  if (!response.ok) return null;

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0) return null;

  return storage.uploadInvoicePdf({
    userId,
    invoiceId,
    body,
    contentLength: body.length,
  });
}

export async function upsertStripeInvoice(
  prisma: PrismaClient,
  invoice: Stripe.Invoice,
  storage?: ObjectStorage,
  fallbackUserId?: string | null
): Promise<StripeInvoiceUpsertResult> {
  const customerId = getInvoiceCustomerId(invoice);
  if (!invoice.id || !customerId) {
    return { handled: false, pdfStored: false, paidNow: false };
  }

  const userId = await resolveInvoiceUserId(prisma, invoice, fallbackUserId);
  if (!userId) {
    return { handled: false, pdfStored: false, paidNow: false };
  }

  const subscriptionId = getInvoiceSubscriptionId(invoice);
  // Subscription invoices: read the billing period from the first line item.
  // The invoice's top-level period_start/period_end can both equal the issue
  // date, which makes the period column read "28 May – 28 May" instead of the
  // actual coverage window. Line items always carry the correct subscription
  // period; fall back to top-level fields only when no line is available.
  const linePeriod = invoice.lines?.data?.[0]?.period;
  const periodStart = timestampToDate(linePeriod?.start)
    ?? timestampToDate((invoice as Stripe.Invoice & { period_start?: number | null }).period_start);
  const periodEnd = timestampToDate(linePeriod?.end)
    ?? timestampToDate((invoice as Stripe.Invoice & { period_end?: number | null }).period_end);
  const paidAt = timestampToDate(invoice.status_transitions?.paid_at ?? null);
  const existingInvoice = await prisma.billingInvoice.findUnique({
    where: { stripeInvoiceId: invoice.id },
    select: { status: true, paidAt: true },
  });
  const paidNow = hasInvoiceBeenPaid(invoice) && !wasStoredInvoicePaid(existingInvoice);

  const stored = await prisma.billingInvoice.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: {
      userId,
      stripeInvoiceId: invoice.id,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      invoiceNumber: invoice.number,
      status: invoice.status ?? "unknown",
      currency: invoice.currency,
      amountDue: invoice.amount_due ?? 0,
      amountPaid: invoice.amount_paid ?? 0,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      stripeInvoicePdfUrl: invoice.invoice_pdf ?? null,
      periodStart,
      periodEnd,
      paidAt,
    },
    update: {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      invoiceNumber: invoice.number,
      status: invoice.status ?? "unknown",
      currency: invoice.currency,
      amountDue: invoice.amount_due ?? 0,
      amountPaid: invoice.amount_paid ?? 0,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      stripeInvoicePdfUrl: invoice.invoice_pdf ?? null,
      periodStart,
      periodEnd,
      paidAt,
    },
  });

  if (!storage || !invoice.invoice_pdf || stored.minioObjectKey) {
    return {
      handled: true,
      pdfStored: Boolean(stored.minioObjectKey),
      paidNow,
      invoiceId: stored.id,
      stripeInvoiceId: stored.stripeInvoiceId,
      invoiceNumber: stored.invoiceNumber,
      amountPaid: stored.amountPaid,
      currency: stored.currency,
    };
  }

  try {
    const minioObjectKey = await mirrorInvoicePdfToStorage(storage, userId, invoice.id, invoice.invoice_pdf);
    if (!minioObjectKey) {
      return {
        handled: true,
        pdfStored: false,
        paidNow,
        invoiceId: stored.id,
        stripeInvoiceId: stored.stripeInvoiceId,
        invoiceNumber: stored.invoiceNumber,
        amountPaid: stored.amountPaid,
        currency: stored.currency,
      };
    }

    await prisma.billingInvoice.update({
      where: { stripeInvoiceId: invoice.id },
      data: { minioObjectKey },
    });

    return {
      handled: true,
      pdfStored: true,
      paidNow,
      invoiceId: stored.id,
      stripeInvoiceId: stored.stripeInvoiceId,
      invoiceNumber: stored.invoiceNumber,
      amountPaid: stored.amountPaid,
      currency: stored.currency,
    };
  } catch {
    return {
      handled: true,
      pdfStored: false,
      paidNow,
      invoiceId: stored.id,
      stripeInvoiceId: stored.stripeInvoiceId,
      invoiceNumber: stored.invoiceNumber,
      amountPaid: stored.amountPaid,
      currency: stored.currency,
    };
  }
}

// Active sync — pulls the latest subscription state from Stripe for every
// linked child of the given parent and upserts it locally. Used after the
// parent returns from the Stripe billing portal so the cancel-at-period-end
// flag reflects on the billing page even if the webhook is delayed or the
// local environment isn't receiving webhooks.
export async function refreshParentChildrenFromStripe(prisma: PrismaClient, parentId: string) {
  const relations = await prisma.parentStudentRelation.findMany({
    where: { parentId, student: { deletedAt: null } },
    select: { studentId: true },
  });
  if (relations.length === 0) return { refreshed: 0 };

  const studentIds = relations.map((r) => r.studentId);
  const subscriptions = await prisma.subscription.findMany({
    where: { userId: { in: studentIds } },
    orderBy: { currentPeriodEnd: "desc" },
    select: { stripeSubscriptionId: true },
  });

  const uniqueIds = Array.from(
    new Set(subscriptions.map((s) => s.stripeSubscriptionId).filter((id): id is string => Boolean(id)))
  );
  if (uniqueIds.length === 0) return { refreshed: 0 };

  let refreshed = 0;
  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const fresh = await retrieveSubscription(id);
        const result = await upsertStripeSubscription(prisma, fresh);
        if (result.handled) refreshed += 1;
      } catch {
        // ignore individual failures so one bad subscription doesn't block the rest
      }
    })
  );

  return { refreshed };
}

export function constructStripeWebhookEvent(rawBody: Buffer, signature: string) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw createHttpError(503, "Stripe webhook not configured");
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

export async function handleStripeEvent(
  prisma: PrismaClient,
  event: Stripe.Event,
  storage?: ObjectStorage
) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) {
        return { handled: false };
      }
      const userId = typeof session.metadata?.userId === "string"
        ? session.metadata.userId
        : session.client_reference_id;
      const subscription = typeof session.subscription === "string"
        ? await retrieveSubscription(session.subscription)
        : session.subscription;
      const result = await upsertStripeSubscription(prisma, subscription, userId);
      return { handled: result.handled };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const result = await upsertStripeSubscription(prisma, subscription);
      return { handled: result.handled };
    }

    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const invoiceSubscription = getSubscriptionFromInvoice(invoice);
      let subscriptionResult: StripeSubscriptionSyncResult = { handled: false };
      let fallbackUserId: string | null = null;

      if (invoiceSubscription) {
        const subscription = typeof invoiceSubscription === "string"
          ? await retrieveSubscription(invoiceSubscription)
          : invoiceSubscription;
        fallbackUserId = getSubscriptionMetadataUserId(subscription);
        subscriptionResult = await upsertStripeSubscription(prisma, subscription);
      }

      const invoiceResult = await upsertStripeInvoice(prisma, invoice, storage, fallbackUserId);
      if (subscriptionResult.handled && invoiceResult.handled && invoiceResult.paidNow) {
        try {
          await notifyMembershipPaymentSucceeded(prisma, {
            userId: subscriptionResult.userId,
            tier: subscriptionResult.tier,
            invoiceId: invoiceResult.invoiceId,
            stripeInvoiceId: invoiceResult.stripeInvoiceId,
            invoiceNumber: invoiceResult.invoiceNumber,
            amountPaid: invoiceResult.amountPaid,
            currency: invoiceResult.currency,
          });
        } catch (error) {
          console.error("[Billing] Failed to send membership payment notifications", error);
        }
      }

      return { handled: subscriptionResult.handled || invoiceResult.handled };
    }

    default:
      return { handled: false };
  }
}
