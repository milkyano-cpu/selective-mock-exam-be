import type { FastifyInstance } from "fastify";
import { subjectRef } from "./subjects.schema.js";
import {
  listSubjects,
  getSubject,
  createSubject,
  ensureSubjectWithTopics,
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

  fastify.post("/import/ensure", {
    schema: {
      body: subjectRef("ensureSubjectTopicsBodySchema"),
      response: {
        200: subjectRef("ensureSubjectTopicsResponseSchema"),
        403: subjectRef("subjectForbiddenResponseSchema"),
      },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: ensureSubjectWithTopics,
  });

  fastify.put("/:subjectId", {
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
