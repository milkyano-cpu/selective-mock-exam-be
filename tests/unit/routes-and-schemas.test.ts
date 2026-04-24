import { describe, expect, it, jest } from "@jest/globals";
import { authRoutes } from "../../src/modules/auth/auth.route.js";
import { authRef, authSchemas } from "../../src/modules/auth/auth.schema.js";
import { healthRoutes } from "../../src/modules/health/health.route.js";
import { healthRef, healthSchemas } from "../../src/modules/health/health.schema.js";
import { usersRoutes } from "../../src/modules/users/users.route.js";
import { userRef, userSchemas } from "../../src/modules/users/users.schema.js";
import { adminRoutes } from "../../src/modules/admin/admin.route.js";
import { adminRef, adminSchemas } from "../../src/modules/admin/admin.schema.js";

function fakeFastify() {
  return {
    authenticate: jest.fn(),
    post: jest.fn(),
    get: jest.fn(),
  };
}

describe("routes and schemas", () => {
  it("exports auth JSON schemas and refs", () => {
    expect(authSchemas.map((schema) => schema.$id)).toEqual([
      "registerBodySchema",
      "registerResponseSchema",
      "loginBodySchema",
      "loginResponseSchema",
      "refreshResponseSchema",
      "logoutResponseSchema",
      "changePasswordBodySchema",
      "changePasswordResponseSchema",
      "forgotPasswordBodySchema",
      "forgotPasswordResponseSchema",
      "resetPasswordBodySchema",
      "resetPasswordResponseSchema",
      "validateResetTokenQuerySchema",
      "validateResetTokenResponseSchema",
    ]);
    expect(authRef("loginBodySchema")).toEqual({ $ref: "loginBodySchema#" });
  });

  it("exports health JSON schemas and refs", () => {
    expect(healthSchemas.map((schema) => schema.$id)).toEqual([
      "healthResponseSchema",
      "healthDegradedResponseSchema",
    ]);
    expect(healthRef("healthResponseSchema")).toEqual({ $ref: "healthResponseSchema#" });
  });

  it("exports user JSON schemas and refs", () => {
    expect(userSchemas.map((schema) => schema.$id)).toEqual([
      "getMeResponseSchema",
      "unauthorizedResponseSchema",
    ]);
    expect(userRef("getMeResponseSchema")).toEqual({ $ref: "getMeResponseSchema#" });
  });

  it("registers auth routes with validation, rate limits, and auth guards", async () => {
    const fastify = fakeFastify();

    await authRoutes(fastify as never);

    expect(fastify.post).toHaveBeenCalledTimes(7);
    expect(fastify.get).toHaveBeenCalledTimes(1);
    expect(fastify.post).toHaveBeenNthCalledWith(
      1,
      "/register",
      expect.objectContaining({
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
        schema: expect.objectContaining({ body: { $ref: "registerBodySchema#" } }),
        handler: expect.any(Function),
      })
    );
    expect(fastify.post).toHaveBeenNthCalledWith(
      2,
      "/login",
      expect.objectContaining({
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: expect.objectContaining({ body: { $ref: "loginBodySchema#" } }),
        handler: expect.any(Function),
      })
    );
    expect(fastify.post).toHaveBeenNthCalledWith(
      3,
      "/refresh",
      expect.objectContaining({
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: expect.objectContaining({
          response: { 200: { $ref: "refreshResponseSchema#" } },
        }),
        handler: expect.any(Function),
      })
    );
    expect(fastify.post).toHaveBeenNthCalledWith(
      4,
      "/logout",
      expect.objectContaining({
        preHandler: [fastify.authenticate],
        handler: expect.any(Function),
      })
    );
    expect(fastify.post).toHaveBeenNthCalledWith(
      5,
      "/forgot-password",
      expect.objectContaining({
        config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
        schema: expect.objectContaining({ body: { $ref: "forgotPasswordBodySchema#" } }),
        handler: expect.any(Function),
      })
    );
    expect(fastify.get).toHaveBeenNthCalledWith(
      1,
      "/validate-reset-token",
      expect.objectContaining({
        config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
        schema: expect.objectContaining({ querystring: { $ref: "validateResetTokenQuerySchema#" } }),
        handler: expect.any(Function),
      })
    );
    expect(fastify.post).toHaveBeenNthCalledWith(
      6,
      "/reset-password",
      expect.objectContaining({
        config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
        schema: expect.objectContaining({ body: { $ref: "resetPasswordBodySchema#" } }),
        handler: expect.any(Function),
      })
    );
    expect(fastify.post).toHaveBeenNthCalledWith(
      7,
      "/change-password",
      expect.objectContaining({
        config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
        preHandler: [fastify.authenticate],
        handler: expect.any(Function),
      })
    );
  });

  it("registers health route", async () => {
    const fastify = fakeFastify();

    await healthRoutes(fastify as never);

    expect(fastify.get).toHaveBeenCalledWith(
      "/health",
      expect.objectContaining({
        schema: {
          response: {
            200: { $ref: "healthResponseSchema#" },
            503: { $ref: "healthDegradedResponseSchema#" },
          },
        },
        handler: expect.any(Function),
      })
    );
  });

  it("registers users routes with auth guard", async () => {
    const fastify = fakeFastify();

    await usersRoutes(fastify as never);

    expect(fastify.get).toHaveBeenCalledWith(
      "/me",
      expect.objectContaining({
        schema: {
          response: {
            200: { $ref: "getMeResponseSchema#" },
            401: { $ref: "unauthorizedResponseSchema#" },
          },
        },
        preHandler: [fastify.authenticate],
        handler: expect.any(Function),
      })
    );
  });

  it("exports admin JSON schemas and refs", () => {
    expect(adminSchemas.map((schema) => schema.$id)).toEqual([
      "createStaffBodySchema",
      "createStaffResponseSchema",
      "forbiddenResponseSchema",
    ]);
    expect(adminRef("createStaffBodySchema")).toEqual({ $ref: "createStaffBodySchema#" });
  });

  it("registers admin routes with auth and role guards", async () => {
    const fastify = fakeFastify();

    await adminRoutes(fastify as never);

    expect(fastify.post).toHaveBeenCalledTimes(1);
    expect(fastify.post).toHaveBeenCalledWith(
      "/users",
      expect.objectContaining({
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        schema: expect.objectContaining({
          body: { $ref: "createStaffBodySchema#" },
          response: {
            201: { $ref: "createStaffResponseSchema#" },
            403: { $ref: "forbiddenResponseSchema#" },
          },
        }),
        preHandler: [fastify.authenticate, expect.any(Function)],
        handler: expect.any(Function),
      })
    );
  });
});
