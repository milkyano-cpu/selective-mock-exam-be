import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { requirePremiumStudentFeature } from "../../utils/membership.js";
import { pathwayPlanRef } from "./pathway-plans.schema.js";
import {
  createPlanHandler,
  listPlansHandler,
  getPlanHandler,
  updatePlanHandler,
  deletePlanHandler,
  publishPlanHandler,
  addPlanPathwayHandler,
  removePlanPathwayHandler,
} from "./pathway-plans.controller.js";

export async function pathwayPlanRoutes(fastify: FastifyInstance) {
  const premiumPathways = requirePremiumStudentFeature("Pathways");

  // POST /pathway-plans (TUTOR or ADMIN only)
  fastify.post("/", {
    schema: {
      tags: ["Pathway Plans"],
      summary: "Create a pathway plan for a student",
      body: pathwayPlanRef("createPlanBodySchema"),
      response: {
        201: pathwayPlanRef("createPlanResponseSchema"),
        403: pathwayPlanRef("planErrorResponseSchema"),
        404: pathwayPlanRef("planErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: createPlanHandler,
  });

  // GET /pathway-plans
  fastify.get("/", {
    schema: {
      tags: ["Pathway Plans"],
      summary: "List pathway plans (scoped by role)",
      querystring: pathwayPlanRef("listPlansQuerySchema"),
      response: { 200: pathwayPlanRef("listPlansResponseSchema") },
    },
    preHandler: [fastify.authenticate, premiumPathways],
    handler: listPlansHandler,
  });

  // GET /pathway-plans/:id
  fastify.get("/:id", {
    schema: {
      tags: ["Pathway Plans"],
      summary: "Get a pathway plan with its pathways and progress",
      params: pathwayPlanRef("planParamsSchema"),
      response: {
        200: pathwayPlanRef("planDetailResponseSchema"),
        403: pathwayPlanRef("planErrorResponseSchema"),
        404: pathwayPlanRef("planErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, premiumPathways],
    handler: getPlanHandler,
  });

  // PATCH /pathway-plans/:id (owner TUTOR or ADMIN)
  fastify.patch("/:id", {
    schema: {
      tags: ["Pathway Plans"],
      summary: "Update a pathway plan",
      params: pathwayPlanRef("planParamsSchema"),
      body: pathwayPlanRef("updatePlanBodySchema"),
      response: {
        200: pathwayPlanRef("createPlanResponseSchema"),
        403: pathwayPlanRef("planErrorResponseSchema"),
        404: pathwayPlanRef("planErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: updatePlanHandler,
  });

  // PATCH /pathway-plans/:id/publish (owner TUTOR or ADMIN) — one-way publish
  fastify.patch("/:id/publish", {
    schema: {
      tags: ["Pathway Plans"],
      summary: "Publish a draft plan so the student can see it",
      params: pathwayPlanRef("planParamsSchema"),
      response: {
        200: pathwayPlanRef("createPlanResponseSchema"),
        403: pathwayPlanRef("planErrorResponseSchema"),
        404: pathwayPlanRef("planErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: publishPlanHandler,
  });

  // DELETE /pathway-plans/:id (owner TUTOR or ADMIN)
  fastify.delete("/:id", {
    schema: {
      tags: ["Pathway Plans"],
      summary: "Delete a pathway plan and cascade its pathways",
      params: pathwayPlanRef("planParamsSchema"),
      response: {
        200: pathwayPlanRef("deletePlanResponseSchema"),
        403: pathwayPlanRef("planErrorResponseSchema"),
        404: pathwayPlanRef("planErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: deletePlanHandler,
  });

  // POST /pathway-plans/:id/pathways (owner TUTOR or ADMIN)
  fastify.post("/:id/pathways", {
    schema: {
      tags: ["Pathway Plans"],
      summary: "Add a pathway (subject) to a plan",
      params: pathwayPlanRef("planParamsSchema"),
      body: pathwayPlanRef("addPlanPathwayBodySchema"),
      response: {
        201: pathwayPlanRef("addPlanPathwayResponseSchema"),
        403: pathwayPlanRef("planErrorResponseSchema"),
        404: pathwayPlanRef("planErrorResponseSchema"),
        409: pathwayPlanRef("planErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: addPlanPathwayHandler,
  });

  // DELETE /pathway-plans/:id/pathways/:pathwayId (owner TUTOR or ADMIN)
  fastify.delete("/:id/pathways/:pathwayId", {
    schema: {
      tags: ["Pathway Plans"],
      summary: "Remove a pathway from a plan (cascade)",
      params: pathwayPlanRef("planPathwayParamsSchema"),
      response: {
        200: pathwayPlanRef("deletePlanResponseSchema"),
        403: pathwayPlanRef("planErrorResponseSchema"),
        404: pathwayPlanRef("planErrorResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("TUTOR", "ADMIN")],
    handler: removePlanPathwayHandler,
  });
}
