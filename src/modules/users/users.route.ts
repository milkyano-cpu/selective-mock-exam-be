import type { FastifyInstance } from "fastify";
import { userRef } from "./users.schema.js";
import { getMe, getMyProfilePhoto, uploadProfilePhoto } from "./users.controller.js";

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
    config: {
      rateLimit: { max: 10, timeWindow: "1 minute" },
    },
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
}
