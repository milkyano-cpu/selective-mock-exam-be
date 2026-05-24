import { randomUUID } from "crypto";
import Fastify, { type FastifyError } from "fastify";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { mapPrismaError } from "./utils/prisma-errors.js";

// Plugins
import prismaPlugin from "./plugins/prisma.plugin.js";
import jwtPlugin from "./plugins/jwt.plugin.js";
import securityPlugin from "./plugins/security.plugin.js";
import tracePlugin from "./plugins/trace.plugin.js";
import redisPlugin from "./plugins/redis.plugin.js";
import rateLimitPlugin from "./plugins/rate-limit.plugin.js";
import storagePlugin from "./plugins/storage.plugin.js";
import profilePhotoCleanupPlugin from "./plugins/profile-photo-cleanup.plugin.js";
import broadcastPlugin from "./plugins/broadcast.plugin.js";
import gradingPlugin from "./plugins/grading.plugin.js";
import cleanupPlugin from "./plugins/cleanup.plugin.js";

// Routes
import { healthRoutes } from "./modules/health/health.route.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { usersRoutes } from "./modules/users/users.route.js";
import { adminRoutes } from "./modules/admin/admin.route.js";
import { subjectRoutes } from "./modules/subjects/subjects.route.js";
import { imageRoutes } from "./modules/images/images.route.js";
import { questionRoutes } from "./modules/questions/questions.route.js";
import { passageRoutes } from "./modules/passages/passages.routes.js";
import { webhookRoutes } from "./modules/webhooks/webhooks.route.js";
import { notificationRoutes } from "./modules/notifications/notifications.route.js";
import { announcementRoutes } from "./modules/announcements/announcements.route.js";
import { pushSubscriptionRoutes } from "./modules/push-subscriptions/push-subscriptions.route.js";
import { bannerRoutes } from "./modules/banners/banners.route.js";
import { countdownRoutes } from "./modules/countdowns/countdowns.route.js";
import { examRoutes } from "./modules/exams/exams.route.js";
import { analyticsRoutes } from "./modules/analytics/analytics.route.js";
import { flashcardRoutes } from "./modules/flashcards/flashcards.route.js";
import { forumRoutes } from "./modules/forum/forum.route.js";
import { aiRubricRoutes } from "./modules/ai-rubrics/ai-rubrics.route.js";
import { aiRubricWritingTypeRoutes } from "./modules/ai-rubric-writing-types/ai-rubric-writing-types.route.js";
import { pathwayRoutes } from "./modules/pathways/pathways.route.js";
import { practiceRoutes } from "./modules/practice/practice.route.js";
import { billingRoutes } from "./modules/billing/billing.route.js";
import { resourceRoutes } from "./modules/resources/resources.route.js";
import { studentCalendarRoutes } from "./modules/student-calendar/student-calendar.route.js";
import { csvTemplateRoutes } from "./modules/csv-templates/csv-templates.route.js";

// Schemas
import { authSchemas } from "./modules/auth/auth.schema.js";
import { userSchemas } from "./modules/users/users.schema.js";
import { healthSchemas } from "./modules/health/health.schema.js";
import { adminSchemas } from "./modules/admin/admin.schema.js";
import { subjectSchemas } from "./modules/subjects/subjects.schema.js";
import { imageSchemas } from "./modules/images/images.schema.js";
import { questionSchemas } from "./modules/questions/questions.schema.js";
import { passageSchemas } from "./modules/passages/passages.schema.js";
import { notificationSchemas } from "./modules/notifications/notifications.schema.js";
import { pushSchemas } from "./modules/push-subscriptions/push-subscriptions.schema.js";
import { announcementSchemas } from "./modules/announcements/announcements.schema.js";
import { bannerSchemas } from "./modules/banners/banners.schema.js";
import { countdownSchemas } from "./modules/countdowns/countdowns.schema.js";
import { examSchemas } from "./modules/exams/exams.schema.js";
import { analyticsSchemas } from "./modules/analytics/analytics.schema.js";
import { flashcardSchemas } from "./modules/flashcards/flashcards.schema.js";
import { forumSchemas } from "./modules/forum/forum.schema.js";
import { aiRubricSchemas } from "./modules/ai-rubrics/ai-rubrics.schema.js";
import { aiRubricWritingTypeSchemas } from "./modules/ai-rubric-writing-types/ai-rubric-writing-types.schema.js";
import { pathwaySchemas } from "./modules/pathways/pathways.schema.js";
import { practiceSchemas } from "./modules/practice/practice.schema.js";
import { billingSchemas } from "./modules/billing/billing.schema.js";
import { resourceSchemas } from "./modules/resources/resources.schema.js";
import { studentCalendarSchemas } from "./modules/student-calendar/student-calendar.schema.js";
import { csvTemplateSchemas } from "./modules/csv-templates/csv-templates.schema.js";

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    requestIdLogLabel: "traceId",
    genReqId: (req) => (req.headers["x-trace-id"] as string) ?? randomUUID(),
    trustProxy: true,
  });

  // ─── Plugins (order matters) ─────────────────────────────────────
  await app.register(securityPlugin);   // CORS + Helmet
  await app.register(tracePlugin);      // Trace ID
  await app.register(redisPlugin);      // Redis connection
  await app.register(rateLimitPlugin);  // Rate limit (global: false, per-route opt-in)
  await app.register(prismaPlugin);     // Database
  await app.register(jwtPlugin);        // JWT
  await app.register(storagePlugin);    // Multipart + object storage
  await app.register(profilePhotoCleanupPlugin);
  await app.register(broadcastPlugin);
  await app.register(gradingPlugin);
  await app.register(cleanupPlugin);    // Expired token cleanup

  // ─── Register JSON Schemas (must be before routes) ───────────────
  for (const schema of [
    ...authSchemas,
    ...userSchemas,
    ...healthSchemas,
    ...adminSchemas,
    ...subjectSchemas,
    ...imageSchemas,
    ...questionSchemas,
    ...passageSchemas,
    ...pushSchemas,
    ...notificationSchemas,
    ...announcementSchemas,
    ...bannerSchemas,
    ...countdownSchemas,
    ...examSchemas,
    ...analyticsSchemas,
    ...flashcardSchemas,
    ...forumSchemas,
    ...aiRubricSchemas,
    ...aiRubricWritingTypeSchemas,
    ...pathwaySchemas,
    ...practiceSchemas,
    ...billingSchemas,
    ...resourceSchemas,
    ...studentCalendarSchemas,
    ...csvTemplateSchemas,
  ]) {
    app.addSchema(schema);
  }

  // ─── Global error handler ─────────────────────────────────────────
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const normalizedError = mapPrismaError(error) ?? error;
    const statusCode = normalizedError.statusCode ?? 500;

    // Only log unexpected server errors — 4xx are client mistakes, not bugs
    if (statusCode >= 500) {
      app.log.error(normalizedError);
    }

    return reply.status(statusCode).send({
      success: false,
      message: statusCode >= 500 ? "Internal Server Error" : normalizedError.message,
      statusCode,
    });
  });

  // ─── 404 Handler ─────────────────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      success: false,
      message: "Route not found",
      statusCode: 404,
    });
  });

  // ─── Routes ──────────────────────────────────────────────────────
  // Health (no prefix)
  await app.register(healthRoutes);

  // API routes with prefix
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(usersRoutes, { prefix: "/users" });
      await api.register(adminRoutes, { prefix: "/admin" });
      await api.register(subjectRoutes, { prefix: "/subjects" });
      await api.register(imageRoutes, { prefix: "/images" });
      await api.register(questionRoutes, { prefix: "/questions" });
      await api.register(pushSubscriptionRoutes, { prefix: "/push" });
      await api.register(passageRoutes, { prefix: "/passages" });
      await api.register(notificationRoutes, { prefix: "/notifications" });
      await api.register(announcementRoutes, { prefix: "/announcements" });
      await api.register(bannerRoutes, { prefix: "/banners" });
      await api.register(countdownRoutes, { prefix: "/countdowns" });
      await api.register(examRoutes, { prefix: "/exams" });
      await api.register(analyticsRoutes, { prefix: "/analytics" });
      await api.register(flashcardRoutes, { prefix: "/flashcards" });
      await api.register(forumRoutes, { prefix: "/forum" });
      await api.register(aiRubricRoutes, { prefix: "/ai-rubrics" });
      await api.register(aiRubricWritingTypeRoutes, { prefix: "/ai-rubric-writing-types" });
      await api.register(pathwayRoutes, { prefix: "/pathways" });
      await api.register(practiceRoutes, { prefix: "/practice" });
      await api.register(billingRoutes, { prefix: "/billing" });
      await api.register(resourceRoutes, { prefix: "/resources" });
      await api.register(studentCalendarRoutes, { prefix: "/student-calendar" });
      await api.register(csvTemplateRoutes, { prefix: "/csv-templates" });
    },
    { prefix: env.API_PREFIX }
  );

  // Webhooks — outside API_PREFIX so Stripe can reach /webhooks/stripe directly
  await app.register(webhookRoutes, { prefix: "/webhooks" });

  return app;
}
