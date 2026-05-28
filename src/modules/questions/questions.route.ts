import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { questionRef } from "./questions.schema.js";
import {
  createQuestionHandler,
  listQuestionsHandler,
  getQuestionHandler,
  updateQuestionHandler,
  deleteQuestionHandler,
  submitQuestionHandler,
  bulkSubmitQuestionsHandler,
  approveQuestionHandler,
  rejectQuestionHandler,
  unpublishQuestionHandler,
  archiveQuestionHandler,
  bulkImportQuestionsHandler,
  resolveImportHandler,
  getNextQuestionIdHandler,
} from "./questions.controller.js";

export async function questionRoutes(fastify: FastifyInstance) {
  // POST /questions/import — must be registered before /:id to avoid conflict
  fastify.post("/import", {
    schema: {
      tags: ["Questions"],
      summary: "Bulk import questions from a CSV file",
      consumes: ["multipart/form-data"],
      response: { 200: questionRef("bulkImportResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: bulkImportQuestionsHandler,
  });

  // POST /questions/import/resolve — must be registered before /:id to avoid conflict
  fastify.post("/import/resolve", {
    schema: {
      tags: ["Questions"],
      summary: "Save previously unresolved import rows now that their Subject/Topic exists",
      body: questionRef("resolveImportBodySchema"),
      response: { 200: questionRef("resolveImportResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: resolveImportHandler,
  });

  // GET /questions/next-id
  fastify.get("/next-id", {
    schema: {
      tags: ["Questions"],
      summary: "Get the next auto-generated Question ID for a subject",
      querystring: questionRef("nextQuestionIdQuerySchema"),
      response: { 200: questionRef("nextQuestionIdResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: getNextQuestionIdHandler,
  });

  // PATCH /questions/submit/bulk
  fastify.patch("/submit/bulk", {
    schema: {
      tags: ["Questions"],
      summary: "Bulk submit draft questions for review",
      body: questionRef("bulkSubmitBodySchema"),
      response: { 200: questionRef("bulkSubmitResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: bulkSubmitQuestionsHandler,
  });

  // POST /questions
  fastify.post("/", {
    schema: {
      tags: ["Questions"],
      summary: "Create a new question",
      body: questionRef("createQuestionBodySchema"),
      response: { 201: questionRef("singleQuestionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createQuestionHandler,
  });

  // GET /questions — STUDENT allowed for pathway practice (published questions only)
  fastify.get("/", {
    schema: {
      tags: ["Questions"],
      summary: "List questions with pagination and filters",
      querystring: questionRef("listQuestionsQuerySchema"),
      response: { 200: questionRef("paginatedQuestionsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR", "STUDENT")],
    handler: listQuestionsHandler,
  });

  // GET /questions/:id
  fastify.get("/:id", {
    schema: {
      tags: ["Questions"],
      summary: "Get a question by ID",
      params: questionRef("idParamSchema"),
      response: { 200: questionRef("singleQuestionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: getQuestionHandler,
  });

  // PUT /questions/:id
  fastify.put("/:id", {
    schema: {
      tags: ["Questions"],
      summary: "Update a question (DRAFT or PENDING_APPROVAL only)",
      params: questionRef("idParamSchema"),
      body: questionRef("updateQuestionBodySchema"),
      response: { 200: questionRef("singleQuestionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: updateQuestionHandler,
  });

  // DELETE /questions/:id
  fastify.delete("/:id", {
    schema: {
      tags: ["Questions"],
      summary: "Delete a question",
      params: questionRef("idParamSchema"),
      response: { 200: questionRef("deleteQuestionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deleteQuestionHandler,
  });

  // PATCH /questions/:id/submit
  fastify.patch("/:id/submit", {
    schema: {
      tags: ["Questions"],
      summary: "Submit a question for review (DRAFT → PENDING_APPROVAL)",
      params: questionRef("idParamSchema"),
      response: { 200: questionRef("singleQuestionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: submitQuestionHandler,
  });

  // PATCH /questions/:id/approve
  fastify.patch("/:id/approve", {
    schema: {
      tags: ["Questions"],
      summary: "Approve a question (PENDING_APPROVAL → PUBLISHED)",
      params: questionRef("idParamSchema"),
      response: { 200: questionRef("singleQuestionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: approveQuestionHandler,
  });

  // PATCH /questions/:id/reject
  fastify.patch("/:id/reject", {
    schema: {
      tags: ["Questions"],
      summary: "Reject a question (PENDING_APPROVAL → DRAFT with rejection note)",
      params: questionRef("idParamSchema"),
      body: questionRef("rejectQuestionBodySchema"),
      response: { 200: questionRef("singleQuestionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: rejectQuestionHandler,
  });

  // PATCH /questions/:id/unpublish — admin only, blocked if used in any exam
  fastify.patch("/:id/unpublish", {
    schema: {
      tags: ["Questions"],
      summary: "Unpublish a question (PUBLISHED → DRAFT) if not used in any exam",
      params: questionRef("idParamSchema"),
      response: { 200: questionRef("singleQuestionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: unpublishQuestionHandler,
  });

  // PATCH /questions/:id/archive — admin only, retires the question from future use
  fastify.patch("/:id/archive", {
    schema: {
      tags: ["Questions"],
      summary: "Archive a question (PUBLISHED → ARCHIVED) so it cannot be added to new exams",
      params: questionRef("idParamSchema"),
      response: { 200: questionRef("singleQuestionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: archiveQuestionHandler,
  });
}
