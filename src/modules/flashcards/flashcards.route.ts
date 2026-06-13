import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { flashcardRef } from "./flashcards.schema.js";
import {
  createFlashcardHandler,
  deleteFlashcardHandler,
  generateFromMistakesHandler,
  getDueFlashcardsHandler,
  getFlashcardStatsHandler,
  listFlashcardsHandler,
  reviewFlashcardHandler,
  updateFlashcardHandler,
} from "./flashcards.controller.js";

export async function flashcardRoutes(fastify: FastifyInstance) {
  fastify.get("/due", {
    schema: { response: { 200: flashcardRef("flashcardsDueResponseSchema") } },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getDueFlashcardsHandler,
  });

  fastify.get("/stats", {
    schema: { response: { 200: flashcardRef("flashcardsStatsResponseSchema") } },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getFlashcardStatsHandler,
  });

  fastify.post("/generate-from-mistakes", {
    schema: {
      body: flashcardRef("generateFromMistakesBodySchema"),
      response: { 201: flashcardRef("generateFromMistakesResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: generateFromMistakesHandler,
  });

  fastify.get("/", {
    schema: {
      querystring: flashcardRef("listFlashcardsQuerySchema"),
      response: { 200: flashcardRef("flashcardsListResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: listFlashcardsHandler,
  });

  fastify.post("/", {
    schema: {
      body: flashcardRef("createFlashcardBodySchema"),
      response: { 201: flashcardRef("flashcardResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: createFlashcardHandler,
  });

  fastify.patch("/:id", {
    schema: {
      params: flashcardRef("flashcardIdParamSchema"),
      body: flashcardRef("updateFlashcardBodySchema"),
      response: { 200: flashcardRef("flashcardResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: updateFlashcardHandler,
  });

  fastify.delete("/:id", {
    schema: {
      params: flashcardRef("flashcardIdParamSchema"),
      response: { 200: flashcardRef("deleteFlashcardResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: deleteFlashcardHandler,
  });

  fastify.post("/:id/review", {
    schema: {
      params: flashcardRef("flashcardIdParamSchema"),
      body: flashcardRef("reviewFlashcardBodySchema"),
      response: { 200: flashcardRef("flashcardResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: reviewFlashcardHandler,
  });
}
