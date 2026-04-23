import type { FastifyInstance } from "fastify";
import { userRef } from "./users.schema.js";
import { getMe } from "./users.controller.js";

export async function usersRoutes(fastify: FastifyInstance) {
  fastify.get("/me", {
    schema: {
      response: {
        200: userRef("getMeResponseSchema"),
        401: userRef("unauthorizedResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: getMe,
  });
}
