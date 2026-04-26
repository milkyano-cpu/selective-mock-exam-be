import type { FastifyInstance } from "fastify";
import { subjectRef } from "./subjects.schema.js";
import {
  listSubjects,
  getSubject,
  createSubject,
  updateSubject,
  deleteSubject,
  listTopics,
  getTopic,
  createTopic,
  updateTopic,
  deleteTopic,
} from "./subjects.controller.js";
import { requireRole } from "../../utils/authz.js";

export async function subjectRoutes(fastify: FastifyInstance) {
  // ── Subject endpoints ───────────────────────────────────────

  fastify.get("/", {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
    schema: {
      querystring: subjectRef("listSubjectsQuerySchema"),
      response: {
        200: subjectRef("listSubjectsResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: listSubjects,
  });

  fastify.get("/:subjectId", {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
    schema: {
      params: subjectRef("subjectParamsSchema"),
      response: {
        200: subjectRef("getSubjectResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
        404: subjectRef("subjectNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: getSubject,
  });

  fastify.post("/", {
    config: {
      rateLimit: { max: 30, timeWindow: "1 minute" },
    },
    schema: {
      body: subjectRef("createSubjectBodySchema"),
      response: {
        201: subjectRef("createSubjectResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: createSubject,
  });

  fastify.put("/:subjectId", {
    config: {
      rateLimit: { max: 30, timeWindow: "1 minute" },
    },
    schema: {
      params: subjectRef("subjectParamsSchema"),
      body: subjectRef("updateSubjectBodySchema"),
      response: {
        200: subjectRef("updateSubjectResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
        404: subjectRef("subjectNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateSubject,
  });

  fastify.delete("/:subjectId", {
    config: {
      rateLimit: { max: 15, timeWindow: "1 minute" },
    },
    schema: {
      params: subjectRef("subjectParamsSchema"),
      response: {
        200: subjectRef("deleteSubjectResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
        404: subjectRef("subjectNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteSubject,
  });

  // ── Topic endpoints (nested under subjects) ────────────────

  fastify.get("/:subjectId/topics", {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
    schema: {
      params: subjectRef("subjectParamsSchema"),
      querystring: subjectRef("listTopicsQuerySchema"),
      response: {
        200: subjectRef("listTopicsResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
        404: subjectRef("subjectNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: listTopics,
  });

  fastify.get("/:subjectId/topics/:topicId", {
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
    schema: {
      params: subjectRef("topicParamsSchema"),
      response: {
        200: subjectRef("getTopicResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
        404: subjectRef("subjectNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate],
    handler: getTopic,
  });

  fastify.post("/:subjectId/topics", {
    config: {
      rateLimit: { max: 30, timeWindow: "1 minute" },
    },
    schema: {
      params: subjectRef("subjectParamsSchema"),
      body: subjectRef("createTopicBodySchema"),
      response: {
        201: subjectRef("createTopicResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
        404: subjectRef("subjectNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: createTopic,
  });

  fastify.put("/:subjectId/topics/:topicId", {
    config: {
      rateLimit: { max: 30, timeWindow: "1 minute" },
    },
    schema: {
      params: subjectRef("topicParamsSchema"),
      body: subjectRef("updateTopicBodySchema"),
      response: {
        200: subjectRef("updateTopicResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
        404: subjectRef("subjectNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateTopic,
  });

  fastify.delete("/:subjectId/topics/:topicId", {
    config: {
      rateLimit: { max: 15, timeWindow: "1 minute" },
    },
    schema: {
      params: subjectRef("topicParamsSchema"),
      response: {
        200: subjectRef("deleteTopicResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
        404: subjectRef("subjectNotFoundResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteTopic,
  });
}
