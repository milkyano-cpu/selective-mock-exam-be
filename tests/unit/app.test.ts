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
  cleanupPlugin: jest.fn(),
  healthRoutes: jest.fn(),
  authRoutes: jest.fn(),
  usersRoutes: jest.fn(),
  adminRoutes: jest.fn(),
};

const mappedError = Object.assign(new Error("Mapped conflict"), { statusCode: 409 });
const mapPrismaError = jest.fn();

jest.unstable_mockModule("fastify", () => ({ default: Fastify }));
jest.unstable_mockModule("../../src/config/env.js", () => ({
  env: { API_PREFIX: "/api/v1" },
}));
jest.unstable_mockModule("../../src/config/logger.js", () => ({ logger: { level: "silent" } }));
jest.unstable_mockModule("../../src/utils/prisma-errors.js", () => ({ mapPrismaError }));
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
    expect(fakeApp.addSchema).toHaveBeenCalledTimes(5);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.securityPlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.storagePlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.profilePhotoCleanupPlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.cleanupPlugin);
    expect(fakeApp.register).toHaveBeenCalledWith(pluginMocks.healthRoutes);
    expect(pluginMocks.authRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/auth" });
    expect(pluginMocks.usersRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/users" });
    expect(pluginMocks.adminRoutes).toHaveBeenCalledWith(fakeApp, { prefix: "/admin" });
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
