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
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
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
      "userUnauthorizedResponseSchema",
      "getMyProfilePhotoResponseSchema",
      "uploadMyProfilePhotoResponseSchema",
      "userNotFoundResponseSchema",
      "deleteAccountResponseSchema",
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
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
        schema: expect.objectContaining({ body: { $ref: "loginBodySchema#" } }),
        handler: expect.any(Function),
      })
    );
    expect(fastify.post).toHaveBeenNthCalledWith(
      3,
      "/refresh",
      expect.objectContaining({
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

    expect(fastify.get).toHaveBeenCalledTimes(2);
    expect(fastify.post).toHaveBeenCalledTimes(1);
    expect(fastify.delete).toHaveBeenCalledTimes(1);

    expect(fastify.get).toHaveBeenNthCalledWith(
      1,
      "/me",
      expect.objectContaining({
        schema: {
          response: {
            200: { $ref: "getMeResponseSchema#" },
            401: { $ref: "userUnauthorizedResponseSchema#" },
          },
        },
        preHandler: [fastify.authenticate],
        handler: expect.any(Function),
      })
    );

    expect(fastify.get).toHaveBeenNthCalledWith(
      2,
      "/me/profile-photo",
      expect.objectContaining({
        schema: {
          response: {
            200: { $ref: "getMyProfilePhotoResponseSchema#" },
            401: { $ref: "userUnauthorizedResponseSchema#" },
            404: { $ref: "userNotFoundResponseSchema#" },
          },
        },
        preHandler: [fastify.authenticate],
        handler: expect.any(Function),
      })
    );

    expect(fastify.post).toHaveBeenNthCalledWith(
      1,
      "/me/profile-photo",
      expect.objectContaining({
        schema: expect.objectContaining({
          consumes: ["multipart/form-data"],
          response: {
            200: { $ref: "uploadMyProfilePhotoResponseSchema#" },
            401: { $ref: "userUnauthorizedResponseSchema#" },
          },
        }),
        preHandler: [fastify.authenticate],
        handler: expect.any(Function),
      })
    );

    expect(fastify.delete).toHaveBeenCalledWith(
      "/me",
      expect.objectContaining({
        schema: expect.objectContaining({
          response: { 200: { $ref: "deleteAccountResponseSchema#" } },
        }),
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
      "tutorParamsSchema",
      "listTutorsQuerySchema",
      "listTutorsResponseSchema",
      "getTutorResponseSchema",
      "updateTutorBodySchema",
      "updateTutorResponseSchema",
      "updateTutorStatusBodySchema",
      "updateTutorStatusResponseSchema",
      "deleteTutorResponseSchema",
      "notFoundResponseSchema",
      "listUsersQuerySchema",
      "listUsersResponseSchema",
      "syncTiersResponseSchema",
      "deleteUserResponseSchema",
    ]);
    expect(adminRef("createStaffBodySchema")).toEqual({ $ref: "createStaffBodySchema#" });
  });

  it("registers admin routes with auth and role guards", async () => {
    const fastify = fakeFastify();

    await adminRoutes(fastify as never);

    expect(fastify.post).toHaveBeenCalledTimes(2);
    expect(fastify.get).toHaveBeenCalledTimes(3);
    expect(fastify.put).toHaveBeenCalledTimes(1);
    expect(fastify.patch).toHaveBeenCalledTimes(1);
    expect(fastify.delete).toHaveBeenCalledTimes(2);
    expect(fastify.post).toHaveBeenCalledWith(
      "/users",
      expect.objectContaining({
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
    expect(fastify.get).toHaveBeenNthCalledWith(
      1,
      "/users",
      expect.objectContaining({
        schema: expect.objectContaining({
          querystring: { $ref: "listUsersQuerySchema#" },
          response: { 200: { $ref: "listUsersResponseSchema#" } },
        }),
        preHandler: [fastify.authenticate, expect.any(Function)],
        handler: expect.any(Function),
      })
    );
    expect(fastify.post).toHaveBeenCalledWith(
      "/users/sync-tiers",
      expect.objectContaining({
        schema: expect.objectContaining({
          response: { 200: { $ref: "syncTiersResponseSchema#" } },
        }),
        preHandler: [fastify.authenticate, expect.any(Function)],
        handler: expect.any(Function),
      })
    );
    expect(fastify.delete).toHaveBeenCalledWith(
      "/users/:id",
      expect.objectContaining({
        schema: expect.objectContaining({
          response: {
            200: { $ref: "deleteUserResponseSchema#" },
            403: { $ref: "forbiddenResponseSchema#" },
            404: { $ref: "notFoundResponseSchema#" },
          },
        }),
        preHandler: [fastify.authenticate, expect.any(Function)],
        handler: expect.any(Function),
      })
    );
    expect(fastify.get).toHaveBeenNthCalledWith(
      2,
      "/tutors",
      expect.objectContaining({
        schema: expect.objectContaining({
          querystring: { $ref: "listTutorsQuerySchema#" },
          response: {
            200: { $ref: "listTutorsResponseSchema#" },
            403: { $ref: "forbiddenResponseSchema#" },
          },
        }),
        preHandler: [fastify.authenticate, expect.any(Function)],
        handler: expect.any(Function),
      })
    );
    expect(fastify.get).toHaveBeenNthCalledWith(
      3,
      "/tutors/:id",
      expect.objectContaining({
        schema: expect.objectContaining({
          params: { $ref: "tutorParamsSchema#" },
          response: {
            200: { $ref: "getTutorResponseSchema#" },
            403: { $ref: "forbiddenResponseSchema#" },
            404: { $ref: "notFoundResponseSchema#" },
          },
        }),
        preHandler: [fastify.authenticate, expect.any(Function)],
        handler: expect.any(Function),
      })
    );
    expect(fastify.put).toHaveBeenCalledWith(
      "/tutors/:id",
      expect.objectContaining({
        schema: expect.objectContaining({
          params: { $ref: "tutorParamsSchema#" },
          body: { $ref: "updateTutorBodySchema#" },
          response: {
            200: { $ref: "updateTutorResponseSchema#" },
            403: { $ref: "forbiddenResponseSchema#" },
            404: { $ref: "notFoundResponseSchema#" },
          },
        }),
        preHandler: [fastify.authenticate, expect.any(Function)],
        handler: expect.any(Function),
      })
    );
    expect(fastify.patch).toHaveBeenCalledWith(
      "/tutors/:id/status",
      expect.objectContaining({
        schema: expect.objectContaining({
          params: { $ref: "tutorParamsSchema#" },
          body: { $ref: "updateTutorStatusBodySchema#" },
          response: {
            200: { $ref: "updateTutorStatusResponseSchema#" },
            403: { $ref: "forbiddenResponseSchema#" },
            404: { $ref: "notFoundResponseSchema#" },
          },
        }),
        preHandler: [fastify.authenticate, expect.any(Function)],
        handler: expect.any(Function),
      })
    );
    expect(fastify.delete).toHaveBeenCalledWith(
      "/tutors/:id",
      expect.objectContaining({
        schema: expect.objectContaining({
          params: { $ref: "tutorParamsSchema#" },
          response: {
            200: { $ref: "deleteTutorResponseSchema#" },
            403: { $ref: "forbiddenResponseSchema#" },
            404: { $ref: "notFoundResponseSchema#" },
          },
        }),
        preHandler: [fastify.authenticate, expect.any(Function)],
        handler: expect.any(Function),
      })
    );
  });
});
