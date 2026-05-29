import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { userRef } from "./users.schema.js";
import { getMe, getMyProfilePhoto, uploadProfilePhoto, deleteMyAccount, deleteChildAccount } from "./users.controller.js";

export async function usersRoutes(fastify: FastifyInstance) {
  fastify.get("/me", {
    schema: {
      response: {
        200: userRef("getMeResponseSchema"),
        401: userRef("userUnauthorizedResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: getMe,
  });

  fastify.get("/me/profile-photo", {
    schema: {
      response: {
        200: userRef("getMyProfilePhotoResponseSchema"),
        401: userRef("userUnauthorizedResponseSchema"),
        404: userRef("userNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: getMyProfilePhoto,
  });

  fastify.post("/me/profile-photo", {
    schema: {
      consumes: ["multipart/form-data"],
      response: {
        200: userRef("uploadMyProfilePhotoResponseSchema"),
        401: userRef("userUnauthorizedResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: uploadProfilePhoto,
  });

  fastify.delete("/me", {
    schema: {
      tags: ["Users"],
      summary: "Delete own account (soft delete)",
      response: { 200: userRef("deleteAccountResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: deleteMyAccount,
  });

  fastify.delete("/parent/children/:studentId", {
    schema: {
      tags: ["Users"],
      summary: "Parent soft-deletes a linked student's account",
      params: userRef("deleteChildParamsSchema"),
      response: {
        200: userRef("deleteAccountResponseSchema"),
        403: userRef("userNotFoundResponseSchema"),
        409: userRef("userNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("PARENT")],
    handler: deleteChildAccount,
  });
}
