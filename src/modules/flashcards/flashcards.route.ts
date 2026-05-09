import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { requirePremiumStudentFeature } from "../../utils/membership.js";
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
  const premiumFlashcards = requirePremiumStudentFeature("Flashcards");

  fastify.get("/due", {
    schema: { response: { 200: flashcardRef("flashcardsDueResponseSchema") } },
    preHandler: [fastify.authenticate, requireRole("STUDENT"), premiumFlashcards],
    handler: getDueFlashcardsHandler,
  });

  fastify.get("/stats", {
    schema: { response: { 200: flashcardRef("flashcardsStatsResponseSchema") } },
    preHandler: [fastify.authenticate, requireRole("STUDENT"), premiumFlashcards],
    handler: getFlashcardStatsHandler,
  });

  fastify.post("/generate-from-mistakes", {
    schema: {
      body: flashcardRef("generateFromMistakesBodySchema"),
      response: { 201: flashcardRef("generateFromMistakesResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT"), premiumFlashcards],
    handler: generateFromMistakesHandler,
  });

  fastify.get("/", {
    schema: {
      querystring: flashcardRef("listFlashcardsQuerySchema"),
      response: { 200: flashcardRef("flashcardsListResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT"), premiumFlashcards],
    handler: listFlashcardsHandler,
  });

  fastify.post("/", {
    schema: {
      body: flashcardRef("createFlashcardBodySchema"),
      response: { 201: flashcardRef("flashcardResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT"), premiumFlashcards],
    handler: createFlashcardHandler,
  });

  fastify.patch("/:id", {
    schema: {
      params: flashcardRef("flashcardIdParamSchema"),
      body: flashcardRef("updateFlashcardBodySchema"),
      response: { 200: flashcardRef("flashcardResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT"), premiumFlashcards],
    handler: updateFlashcardHandler,
  });

  fastify.delete("/:id", {
    schema: {
      params: flashcardRef("flashcardIdParamSchema"),
      response: { 200: flashcardRef("deleteFlashcardResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT"), premiumFlashcards],
    handler: deleteFlashcardHandler,
  });

  fastify.post("/:id/review", {
    schema: {
      params: flashcardRef("flashcardIdParamSchema"),
      body: flashcardRef("reviewFlashcardBodySchema"),
      response: { 200: flashcardRef("flashcardResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT"), premiumFlashcards],
    handler: reviewFlashcardHandler,
  });
}
