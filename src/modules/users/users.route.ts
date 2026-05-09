import type { FastifyInstance } from "fastify";
import { userRef } from "./users.schema.js";
import { getMe, getMyProfilePhoto, uploadProfilePhoto, deleteMyAccount } from "./users.controller.js";

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
}
