import type { FastifyInstance } from "fastify";
import { aiRubricWritingTypeRef } from "./ai-rubric-writing-types.schema.js";
import {
  listWritingTypes,
  getWritingType,
  createWritingType,
  updateWritingType,
  deleteWritingType,
} from "./ai-rubric-writing-types.controller.js";
import { requireRole } from "../../utils/authz.js";

export async function aiRubricWritingTypeRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      tags: ["AI Rubric Writing Types"],
      summary: "List all available writing types",
      response: {
        200: aiRubricWritingTypeRef("listWritingTypesResponseSchema"),
        403: aiRubricWritingTypeRef("aiRubricWritingTypeForbiddenResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: listWritingTypes,
  });

  fastify.get("/:id", {
    schema: {
      tags: ["AI Rubric Writing Types"],
      summary: "Get a writing type by id",
      params: aiRubricWritingTypeRef("writingTypeParamsSchema"),
      response: {
        200: aiRubricWritingTypeRef("singleWritingTypeResponseSchema"),
        403: aiRubricWritingTypeRef("aiRubricWritingTypeForbiddenResponseSchema"),
        404: aiRubricWritingTypeRef("aiRubricWritingTypeNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: getWritingType,
  });

  fastify.post("/", {
    schema: {
      tags: ["AI Rubric Writing Types"],
      summary: "Create a new writing type",
      body: aiRubricWritingTypeRef("createWritingTypeBodySchema"),
      response: {
        201: aiRubricWritingTypeRef("singleWritingTypeResponseSchema"),
        403: aiRubricWritingTypeRef("aiRubricWritingTypeForbiddenResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: createWritingType,
  });

  fastify.put("/:id", {
    schema: {
      tags: ["AI Rubric Writing Types"],
      summary: "Update an existing writing type",
      params: aiRubricWritingTypeRef("writingTypeParamsSchema"),
      body: aiRubricWritingTypeRef("updateWritingTypeBodySchema"),
      response: {
        200: aiRubricWritingTypeRef("singleWritingTypeResponseSchema"),
        403: aiRubricWritingTypeRef("aiRubricWritingTypeForbiddenResponseSchema"),
        404: aiRubricWritingTypeRef("aiRubricWritingTypeNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateWritingType,
  });

  fastify.delete("/:id", {
    schema: {
      tags: ["AI Rubric Writing Types"],
      summary: "Delete a writing type",
      params: aiRubricWritingTypeRef("writingTypeParamsSchema"),
      response: {
        200: aiRubricWritingTypeRef("deleteWritingTypeResponseSchema"),
        403: aiRubricWritingTypeRef("aiRubricWritingTypeForbiddenResponseSchema"),
        404: aiRubricWritingTypeRef("aiRubricWritingTypeNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteWritingType,
  });
}
