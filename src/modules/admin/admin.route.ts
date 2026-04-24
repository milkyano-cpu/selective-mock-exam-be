import type { FastifyInstance } from "fastify";
import { adminRef } from "./admin.schema.js";
import { createStaff } from "./admin.controller.js";
import { requireRole } from "../../utils/authz.js";

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.post("/users", {
    config: {
      rateLimit: { max: 30, timeWindow: "1 minute" },
    },
    schema: {
      body: adminRef("createStaffBodySchema"),
      response: {
        201: adminRef("createStaffResponseSchema"),
        403: adminRef("forbiddenResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: createStaff,
  });
}
