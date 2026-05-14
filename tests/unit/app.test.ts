import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const fakeApp = {
  register: jest.fn(),
  addSchema: jest.fn(),
  setErrorHandler: jest.fn(),
  setNotFoundHandler: jest.fn(),
  log: { error: jest.fn() },
};
const Fastify = jest.fn(() => fakeApp);

const pluginMocks = {
  prismaPlugin: jest.fn(),
  jwtPlugin: jest.fn(),
  securityPlugin: jest.fn(),
  tracePlugin: jest.fn(),
  redisPlugin: jest.fn(),
  rateLimitPlugin: jest.fn(),
  storagePlugin: jest.fn(),
  profilePhotoCleanupPlugin: jest.fn(),
  broadcastPlugin: jest.fn(),
  gradingPlugin: jest.fn(),
  cleanupPlugin: jest.fn(),
  healthRoutes: jest.fn(),
  authRoutes: jest.fn(),
  usersRoutes: jest.fn(),
  adminRoutes: jest.fn(),
  subjectRoutes: jest.fn(),
  imageRoutes: jest.fn(),
  questionRoutes: jest.fn(),
  passageRoutes: jest.fn(),
  webhookRoutes: jest.fn(),
  notificationRoutes: jest.fn(),
  announcementRoutes: jest.fn(),
  pushSubscriptionRoutes: jest.fn(),
  bannerRoutes: jest.fn(),
  countdownRoutes: jest.fn(),
  examRoutes: jest.fn(),
  analyticsRoutes: jest.fn(),
  flashcardRoutes: jest.fn(),
  forumRoutes: jest.fn(),
  aiRubricRoutes: jest.fn(),
  pathwayRoutes: jest.fn(),
  practiceRoutes: jest.fn(),
  billingRoutes: jest.fn(),
  resourceRoutes: jest.fn(),
  studentCalendarRoutes: jest.fn(),
};

const mappedError = Object.assign(new Error("Mapped conflict"), { statusCode: 409 });
const mapPrismaError = jest.fn();
const isUniqueConstraintError = jest.fn();

jest.unstable_mockModule("fastify", () => ({ default: Fastify }));
jest.unstable_mockModule("../../src/config/env.js", () => ({
  env: { API_PREFIX: "/api/v1" },
}));
jest.unstable_mockModule("../../src/config/logger.js", () => ({ logger: { level: "silent" } }));
jest.unstable_mockModule("../../src/utils/prisma-errors.js", () => ({ isUniqueConstraintError, mapPrismaError }));
jest.unstable_mockModule("../../src/plugins/prisma.plugin.js", () => ({ default: pluginMocks.prismaPlugin }));
jest.unstable_mockModule("../../src/plugins/jwt.plugin.js", () => ({ default: pluginMocks.jwtPlugin }));
jest.unstable_mockModule("../../src/plugins/security.plugin.js", () => ({ default: pluginMocks.securityPlugin }));
jest.unstable_mockModule("../../src/plugins/trace.plugin.js", () => ({ default: pluginMocks.tracePlugin }));
jest.unstable_mockModule("../../src/plugins/redis.plugin.js", () => ({ default: pluginMocks.redisPlugin }));
jest.unstable_mockModule("../../src/plugins/rate-limit.plugin.js", () => ({ default: pluginMocks.rateLimitPlugin }));
jest.unstable_mockModule("../../src/plugins/storage.plugin.js", () => ({ default: pluginMocks.storagePlugin }));
jest.unstable_mockModule("../../src/plugins/profile-photo-cleanup.plugin.js", () => ({
  default: pluginMocks.profilePhotoCleanupPlugin,
}));
jest.unstable_mockModule("../../src/plugins/broadcast.plugin.js", () => ({ default: pluginMocks.broadcastPlugin }));
jest.unstable_mockModule("../../src/plugins/grading.plugin.js", () => ({ default: pluginMocks.gradingPlugin }));
jest.unstable_mockModule("../../src/plugins/cleanup.plugin.js", () => ({ default: pluginMocks.cleanupPlugin }));
jest.unstable_mockModule("../../src/modules/health/health.route.js", () => ({
  healthRoutes: pluginMocks.healthRoutes,
}));
jest.unstable_mockModule("../../src/modules/auth/auth.route.js", () => ({
  authRoutes: pluginMocks.authRoutes,
}));
jest.unstable_mockModule("../../src/modules/users/users.route.js", () => ({
  usersRoutes: pluginMocks.usersRoutes,
}));
jest.unstable_mockModule("../../src/modules/admin/admin.route.js", () => ({
  adminRoutes: pluginMocks.adminRoutes,
}));
jest.unstable_mockModule("../../src/modules/subjects/subjects.route.js", () => ({
  subjectRoutes: pluginMocks.subjectRoutes,
}));
jest.unstable_mockModule("../../src/modules/images/images.route.js", () => ({
  imageRoutes: pluginMocks.imageRoutes,
}));
jest.unstable_mockModule("../../src/modules/questions/questions.route.js", () => ({
  questionRoutes: pluginMocks.questionRoutes,
}));
jest.unstable_mockModule("../../src/modules/passages/passages.routes.js", () => ({
  passageRoutes: pluginMocks.passageRoutes,
}));
jest.unstable_mockModule("../../src/modules/webhooks/webhooks.route.js", () => ({
  webhookRoutes: pluginMocks.webhookRoutes,
}));
jest.unstable_mockModule("../../src/modules/notifications/notifications.route.js", () => ({
  notificationRoutes: pluginMocks.notificationRoutes,
}));
jest.unstable_mockModule("../../src/modules/announcements/announcements.route.js", () => ({
  announcementRoutes: pluginMocks.announcementRoutes,
}));
jest.unstable_mockModule("../../src/modules/push-subscriptions/push-subscriptions.route.js", () => ({
  pushSubscriptionRoutes: pluginMocks.pushSubscriptionRoutes,
}));
jest.unstable_mockModule("../../src/modules/banners/banners.route.js", () => ({
  bannerRoutes: pluginMocks.bannerRoutes,
}));
jest.unstable_mockModule("../../src/modules/countdowns/countdowns.route.js", () => ({
  countdownRoutes: pluginMocks.countdownRoutes,
}));
jest.unstable_mockModule("../../src/modules/exams/exams.route.js", () => ({
  examRoutes: pluginMocks.examRoutes,
}));
jest.unstable_mockModule("../../src/modules/analytics/analytics.route.js", () => ({
  analyticsRoutes: pluginMocks.analyticsRoutes,
}));
jest.unstable_mockModule("../../src/modules/flashcards/flashcards.route.js", () => ({
  flashcardRoutes: pluginMocks.flashcardRoutes,
}));
jest.unstable_mockModule("../../src/modules/forum/forum.route.js", () => ({
  forumRoutes: pluginMocks.forumRoutes,
}));
jest.unstable_mockModule("../../src/modules/ai-rubrics/ai-rubrics.route.js", () => ({
  aiRubricRoutes: pluginMocks.aiRubricRoutes,
}));
jest.unstable_mockModule("../../src/modules/pathways/pathways.route.js", () => ({
  pathwayRoutes: pluginMocks.pathwayRoutes,
}));
jest.unstable_mockModule("../../src/modules/practice/practice.route.js", () => ({
  practiceRoutes: pluginMocks.practiceRoutes,
}));
jest.unstable_mockModule("../../src/modules/billing/billing.route.js", () => ({
  billingRoutes: pluginMocks.billingRoutes,
}));
jest.unstable_mockModule("../../src/modules/resources/resources.route.js", () => ({
  resourceRoutes: pluginMocks.resourceRoutes,
}));
jest.unstable_mockModule("../../src/modules/student-calendar/student-calendar.route.js", () => ({
  studentCalendarRoutes: pluginMocks.studentCalendarRoutes,
}));
jest.unstable_mockModule("../../src/modules/auth/auth.schema.js", () => ({
  authSchemas: [{ $id: "auth" }],
}));
jest.unstable_mockModule("../../src/modules/users/users.schema.js", () => ({
  userSchemas: [{ $id: "user" }],
}));
jest.unstable_mockModule("../../src/modules/health/health.schema.js", () => ({
  healthSchemas: [{ $id: "health" }, { $id: "healthDegraded" }],
}));
jest.unstable_mockModule("../../src/modules/admin/admin.schema.js", () => ({
  adminSchemas: [{ $id: "admin" }],
}));
jest.unstable_mockModule("../../src/modules/subjects/subjects.schema.js", () => ({
  subjectSchemas: [{ $id: "subject" }],
}));
jest.unstable_mockModule("../../src/modules/images/images.schema.js", () => ({
  imageSchemas: [{ $id: "image" }],
}));
jest.unstable_mockModule("../../src/modules/questions/questions.schema.js", () => ({
  questionSchemas: [{ $id: "question" }],
}));
jest.unstable_mockModule("../../src/modules/passages/passages.schema.js", () => ({
  passageSchemas: [{ $id: "passage" }],
}));
jest.unstable_mockModule("../../src/modules/notifications/notifications.schema.js", () => ({
  notificationSchemas: [{ $id: "notification" }],
}));
jest.unstable_mockModule("../../src/modules/push-subscriptions/push-subscriptions.schema.js", () => ({
  pushSchemas: [{ $id: "push" }],
}));
jest.unstable_mockModule("../../src/modules/announcements/announcements.schema.js", () => ({
  announcementSchemas: [{ $id: "announcement" }],
}));
jest.unstable_mockModule("../../src/modules/banners/banners.schema.js", () => ({
  bannerSchemas: [{ $id: "banner" }],
}));
jest.unstable_mockModule("../../src/modules/countdowns/countdowns.schema.js", () => ({
  countdownSchemas: [{ $id: "countdown" }],
}));
jest.unstable_mockModule("../../src/modules/exams/exams.schema.js", () => ({
  examSchemas: [{ $id: "exam" }],
}));
jest.unstable_mockModule("../../src/modules/analytics/analytics.schema.js", () => ({
  analyticsSchemas: [{ $id: "analytics" }],
}));
jest.unstable_mockModule("../../src/modules/flashcards/flashcards.schema.js", () => ({
  flashcardSchemas: [{ $id: "flashcard" }],
}));
jest.unstable_mockModule("../../src/modules/forum/forum.schema.js", () => ({
  forumSchemas: [{ $id: "forum" }],
}));
jest.unstable_mockModule("../../src/modules/ai-rubrics/ai-rubrics.schema.js", () => ({
  aiRubricSchemas: [{ $id: "aiRubric" }],
}));
jest.unstable_mockModule("../../src/modules/pathways/pathways.schema.js", () => ({
  pathwaySchemas: [{ $id: "pathway" }],
}));
jest.unstable_mockModule("../../src/modules/practice/practice.schema.js", () => ({
  practiceSchemas: [{ $id: "practice" }],
}));
jest.unstable_mockModule("../../src/modules/billing/billing.schema.js", () => ({
  billingSchemas: [{ $id: "billing" }],
}));
jest.unstable_mockModule("../../src/modules/resources/resources.schema.js", () => ({
  resourceSchemas: [{ $id: "resource" }],
}));
jest.unstable_mockModule("../../src/modules/student-calendar/student-calendar.schema.js", () => ({
  studentCalendarSchemas: [{ $id: "studentCalendar" }],
}));

const { buildApp } = await import("../../src/app.js");

function mockReply() {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
}

describe("app builder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeApp.register.mockImplementation(async (plugin: unknown, options?: unknown) => {
      if (typeof plugin === "function") {
        await plugin(fakeApp, options);
      }
    });
    isUniqueConstraintError.mockReturnValue(false);
    mapPrismaError.mockReturnValue(null);
  });

  it("builds Fastify with plugins, schemas, routes, and request IDs", async () => {
    const app = await buildApp();
    const fastifyOptionsCall = (Fastify as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const options = fastifyOptionsCall?.[0] as unknown as {
      requestIdLogLabel: string;
      trustProxy: boolean;
      genReqId: (request: { headers: Record<string, string> }) => string;
    };

    expect(app).toBe(fakeApp);
    expect(options.requestIdLogLabel).toBe("traceId");
    expect(options.trustProxy).toBe(true);
    expect(options.genReqId({ headers: { "x-trace-id": "trace-1" } })).toBe("trace-1");
    expect(options.genReqId({ headers: {} })).toEqual(expect.any(String));
    expect(fakeApp.addSchema).toHaveBeenCalledTimes(24);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.securityPlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.storagePlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.profilePhotoCleanupPlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.broadcastPlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.gradingPlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.cleanupPlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.healthRoutes);
    expect(pluginMocks.authRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/auth" });
    expect(pluginMocks.usersRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/users" });
    expect(pluginMocks.adminRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/admin" });
    expect(pluginMocks.subjectRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/subjects" });
    expect(pluginMocks.imageRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/images" });
    expect(pluginMocks.questionRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/questions" });
    expect(pluginMocks.webhookRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/webhooks" });
    expect(pluginMocks.billingRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/billing" });
    expect(pluginMocks.resourceRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/resources" });
    expect(pluginMocks.studentCalendarRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/student-calendar" });
    expect(fakeApp.setErrorHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(fakeApp.setNotFoundHandler).toHaveBeenCalledWith(expect.any(Function));
  });

  it("formats client errors", async () => {
    await buildApp();
    const handler = fakeApp.setErrorHandler.mock.calls[0]?.[0] as (
      error: Error & { statusCode?: number },
      request: unknown,
      reply: ReturnType<typeof mockReply>
    ) => void;
    const reply = mockReply();

    handler(Object.assign(new Error("Bad request"), { statusCode: 400 }), {}, reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Bad request",
      statusCode: 400,
    });
    expect(fakeApp.log.error).not.toHaveBeenCalled();
  });

  it("formats mapped Prisma errors", async () => {
    mapPrismaError.mockReturnValue(mappedError);
    await buildApp();
    const handler = fakeApp.setErrorHandler.mock.calls[0]?.[0] as (
      error: Error & { statusCode?: number },
      request: unknown,
      reply: ReturnType<typeof mockReply>
    ) => void;
    const reply = mockReply();

    handler(new Error("Raw Prisma"), {}, reply);

    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Mapped conflict",
      statusCode: 409,
    });
  });

  it("formats server errors without leaking messages", async () => {
    await buildApp();
    const handler = fakeApp.setErrorHandler.mock.calls[0]?.[0] as (
      error: Error & { statusCode?: number },
      request: unknown,
      reply: ReturnType<typeof mockReply>
    ) => void;
    const reply = mockReply();
    const error = new Error("Database password leaked");

    handler(error, {}, reply);

    expect(fakeApp.log.error).toHaveBeenCalledWith(error);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Internal Server Error",
      statusCode: 500,
    });
  });

  it("formats not found responses", async () => {
    await buildApp();
    const handler = fakeApp.setNotFoundHandler.mock.calls[0]?.[0] as (
      request: unknown,
      reply: ReturnType<typeof mockReply>
    ) => void;
    const reply = mockReply();

    handler({}, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Route not found",
      statusCode: 404,
    });
  });
});
