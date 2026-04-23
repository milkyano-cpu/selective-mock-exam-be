import { describe, expect, it, jest } from "@jest/globals";
import { authRoutes } from "../../src/modules/auth/auth.route.js";
import { authRef, authSchemas } from "../../src/modules/auth/auth.schema.js";
import { healthRoutes } from "../../src/modules/health/health.route.js";
import { healthRef, healthSchemas } from "../../src/modules/health/health.schema.js";
import { usersRoutes } from "../../src/modules/users/users.route.js";
import { userRef, userSchemas } from "../../src/modules/users/users.schema.js";

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
      "refreshBodySchema",
      "refreshResponseSchema",
      "logoutResponseSchema",
      "changePasswordBodySchema",
      "changePasswordResponseSchema",
    ]);
    expect(authRef("loginBodySchema")).toEqual({ $ref: "loginBodySchema#" });
  });

  it("exports health JSON schemas and refs", () => {
    expect(healthSchemas.map((schema) => schema.$id)).toEqual(["healthResponseSchema"]);
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

    expect(fastify.post).toHaveBeenCalledTimes(5);
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
        schema: expect.objectContaining({ body: { $ref: "refreshBodySchema#" } }),
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
        schema: { response: { 200: { $ref: "healthResponseSchema#" } } },
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
});
