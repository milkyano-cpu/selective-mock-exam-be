import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateFlashcardBody,
  GenerateFromMistakesBody,
  ListFlashcardsQuery,
  ReviewFlashcardBody,
  UpdateFlashcardBody,
} from "./flashcards.schema.js";
import {
  createFlashcard,
  deleteFlashcard,
  generateFromMistakes,
  getDueFlashcards,
  getFlashcardStats,
  listFlashcards,
  reviewFlashcard,
  updateFlashcard,
} from "./flashcards.service.js";

function getStudentId(request: FastifyRequest) {
  return request.user.sub;
}

export async function listFlashcardsHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListFlashcardsQuery;
  const result = await listFlashcards(request.server.prisma, getStudentId(request), query);
  return reply.send({ success: true, message: "Flashcards retrieved successfully", ...result });
}

export async function getDueFlashcardsHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await getDueFlashcards(request.server.prisma, getStudentId(request));
  return reply.send({ success: true, message: "Due flashcards retrieved successfully", data });
}

export async function getFlashcardStatsHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await getFlashcardStats(request.server.prisma, getStudentId(request));
  return reply.send({ success: true, message: "Flashcard stats retrieved successfully", data });
}

export async function createFlashcardHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateFlashcardBody;
  const data = await createFlashcard(request.server.prisma, getStudentId(request), body);
  return reply.status(201).send({ success: true, message: "Flashcard created successfully", data });
}

export async function updateFlashcardHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as UpdateFlashcardBody;
  const data = await updateFlashcard(request.server.prisma, getStudentId(request), id, body);
  return reply.send({ success: true, message: "Flashcard updated successfully", data });
}

export async function deleteFlashcardHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await deleteFlashcard(request.server.prisma, getStudentId(request), id);
  return reply.send({ success: true, message: "Flashcard deleted successfully" });
}

export async function reviewFlashcardHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as ReviewFlashcardBody;
  const data = await reviewFlashcard(request.server.prisma, getStudentId(request), id, body.rating);
  return reply.send({ success: true, message: "Flashcard review recorded successfully", data });
}

export async function generateFromMistakesHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as GenerateFromMistakesBody;
  const data = await generateFromMistakes(request.server.prisma, getStudentId(request), body);
  return reply.status(201).send({ success: true, message: "Flashcards generated from mistakes", data });
}
