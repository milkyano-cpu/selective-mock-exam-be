import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { examRef } from "./exams.schema.js";
import {
  createExamHandler,
  listExamsHandler,
  getExamWithQuestionsHandler,
  updateExamHandler,
  deleteExamHandler,
  publishExamHandler,
  addExamQuestionsHandler,
  removeExamQuestionHandler,
  listSessionsHandler,
  startSessionHandler,
  getSessionHandler,
  submitAnswerHandler,
  batchAnswersHandler,
  sessionHeartbeatHandler,
  submitSessionHandler,
  getSessionResultHandler,
  listExamSubmissionsHandler,
  getReviewSessionHandler,
  submitManualGradesHandler,
  getSessionInsightsHandler,
  startRetakeHandler,
  getExamAttemptSummaryHandler,
} from "./exams.controller.js";

export async function examRoutes(fastify: FastifyInstance) {
  // ── Session routes (must be registered before /:id to avoid conflict) ────────

  // GET /exams/sessions — list student's exam history
  fastify.get("/sessions", {
    schema: {
      tags: ["Exams"],
      summary: "List the authenticated student's exam sessions",
      querystring: examRef("listSessionsQuerySchema"),
      response: { 200: examRef("paginatedSessionsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: listSessionsHandler,
  });

  // GET /exams/sessions/:sessionId — get active session with questions
  fastify.get("/sessions/:sessionId", {
    schema: {
      tags: ["Exams"],
      summary: "Get an in-progress exam session with questions",
      params: examRef("examSessionParamSchema"),
      response: { 200: examRef("startSessionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getSessionHandler,
  });

  // POST /exams/sessions/:sessionId/answers — save/update an answer
  fastify.post("/sessions/:sessionId/answers", {
    schema: {
      tags: ["Exams"],
      summary: "Save or update a student answer in an active session",
      params: examRef("examSessionParamSchema"),
      body: examRef("submitAnswerBodySchema"),
      response: { 200: examRef("submitAnswerResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: submitAnswerHandler,
  });

  // PUT /exams/sessions/:sessionId/answers/batch — batch upsert answers
  fastify.put("/sessions/:sessionId/answers/batch", {
    schema: {
      tags: ["Exams"],
      summary: "Batch save/update student answers in an active session",
      params: examRef("examSessionParamSchema"),
      body: examRef("batchAnswersBodySchema"),
      response: { 200: examRef("batchAnswersResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: batchAnswersHandler,
  });

  // POST /exams/sessions/:sessionId/heartbeat — record timer heartbeat and active question time
  fastify.post("/sessions/:sessionId/heartbeat", {
    schema: {
      tags: ["Exams"],
      summary: "Record exam timer heartbeat and active question time",
      params: examRef("examSessionParamSchema"),
      body: examRef("sessionHeartbeatBodySchema"),
      response: { 200: examRef("sessionHeartbeatResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: sessionHeartbeatHandler,
  });

  // PATCH /exams/sessions/:sessionId/submit — finalize and submit exam
  fastify.patch("/sessions/:sessionId/submit", {
    schema: {
      tags: ["Exams"],
      summary: "Submit an exam session for grading",
      params: examRef("examSessionParamSchema"),
      body: examRef("submitSessionBodySchema"),
      response: { 200: examRef("submitSessionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: submitSessionHandler,
  });

  // GET /exams/sessions/:sessionId/result — get graded results
  fastify.get("/sessions/:sessionId/result", {
    schema: {
      tags: ["Exams"],
      summary: "Get exam results after submission",
      params: examRef("examSessionParamSchema"),
      response: { 200: examRef("sessionResultResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getSessionResultHandler,
  });

  // GET /exams/sessions/:sessionId/insights — get AI analysis
  fastify.get("/sessions/:sessionId/insights", {
    schema: {
      tags: ["Exams"],
      summary: "Get AI generated performance insights for a session",
      params: examRef("examSessionParamSchema"),
      response: { 200: examRef("sessionInsightsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getSessionInsightsHandler,
  });

  // GET /exams/sessions/:sessionId/review — get a session for tutor/admin manual grading
  fastify.get("/sessions/:sessionId/review", {
    schema: {
      tags: ["Exams"],
      summary: "Get an exam session for tutor/admin review",
      params: examRef("examSessionParamSchema"),
      response: { 200: examRef("reviewSessionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: getReviewSessionHandler,
  });

  // PATCH /exams/sessions/:sessionId/manual-grades — save manual grades for essay answers
  fastify.patch("/sessions/:sessionId/manual-grades", {
    schema: {
      tags: ["Exams"],
      summary: "Save manual grades for a submitted exam session",
      params: examRef("examSessionParamSchema"),
      body: examRef("submitManualGradesBodySchema"),
      response: { 200: examRef("submitManualGradesResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: submitManualGradesHandler,
  });

  // ── Exam CRUD ─────────────────────────────────────────────────────────────────

  // POST /exams
  fastify.post("/", {
    schema: {
      tags: ["Exams"],
      summary: "Create a new exam",
      body: examRef("createExamBodySchema"),
      response: { 201: examRef("singleExamResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: createExamHandler,
  });

  // GET /exams
  fastify.get("/", {
    schema: {
      tags: ["Exams"],
      summary: "List all exams",
      querystring: examRef("listExamsQuerySchema"),
      response: { 200: examRef("paginatedExamsResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: listExamsHandler,
  });

  // ── Exam detail / question management (/:id must come after static paths) ────

  // POST /exams/:id/retake — start a retake session (incorrect only, subject only, or full)
  fastify.post("/:id/retake", {
    schema: {
      tags: ["Exams"],
      summary: "Start a retake session for an exam",
      params: examRef("examIdParamSchema"),
      body: examRef("startRetakeBodySchema"),
      response: { 201: examRef("startSessionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: startRetakeHandler,
  });

  // GET /exams/:id/attempts — get attempt summary for a student
  fastify.get("/:id/attempts", {
    schema: {
      tags: ["Exams"],
      summary: "Get exam attempt summary (first, latest, best score, incorrect questions)",
      params: examRef("examIdParamSchema"),
      response: { 200: examRef("examAttemptSummaryResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: getExamAttemptSummaryHandler,
  });

  // POST /exams/:id/sessions — start or resume an exam session
  fastify.post("/:id/sessions", {
    schema: {
      tags: ["Exams"],
      summary: "Start or resume an exam session",
      params: examRef("examIdParamSchema"),
      response: { 200: examRef("startSessionResponseSchema"), 201: examRef("startSessionResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("STUDENT")],
    handler: startSessionHandler,
  });

  // POST /exams/:id/questions — add questions to exam
  fastify.post("/:id/questions", {
    schema: {
      tags: ["Exams"],
      summary: "Add questions to an exam",
      params: examRef("examIdParamSchema"),
      body: examRef("addExamQuestionsBodySchema"),
      response: { 201: examRef("examQuestionsListResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: addExamQuestionsHandler,
  });

  // DELETE /exams/:id/questions/:questionId — remove question from exam
  fastify.delete("/:id/questions/:questionId", {
    schema: {
      tags: ["Exams"],
      summary: "Remove a question from an exam",
      params: examRef("examQuestionParamSchema"),
      response: { 200: examRef("examDeleteResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: removeExamQuestionHandler,
  });

  // GET /exams/:id — get exam detail with questions (admin/tutor see full, student sees without answers)
  fastify.get("/:id", {
    schema: {
      tags: ["Exams"],
      summary: "Get exam detail with its questions",
      params: examRef("examIdParamSchema"),
      response: { 200: examRef("examWithQuestionsResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: getExamWithQuestionsHandler,
  });

  // GET /exams/:id/submissions — list submissions for tutor/admin manual grading queue
  fastify.get("/:id/submissions", {
    schema: {
      tags: ["Exams"],
      summary: "List submissions for an exam",
      params: examRef("examIdParamSchema"),
      querystring: examRef("examSubmissionsQuerySchema"),
      response: { 200: examRef("examSubmissionsResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: listExamSubmissionsHandler,
  });

  // PATCH /exams/:id/publish — set exam status to DRAFT or PUBLISHED
  fastify.patch("/:id/publish", {
    schema: {
      tags: ["Exams"],
      summary: "Publish or unpublish an exam",
      params: examRef("examIdParamSchema"),
      body: examRef("publishExamBodySchema"),
      response: { 200: examRef("publishExamResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: publishExamHandler,
  });

  // PUT /exams/:id
  fastify.put("/:id", {
    schema: {
      tags: ["Exams"],
      summary: "Update exam metadata",
      params: examRef("examIdParamSchema"),
      body: examRef("updateExamBodySchema"),
      response: { 200: examRef("singleExamResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateExamHandler,
  });

  // DELETE /exams/:id
  fastify.delete("/:id", {
    schema: {
      tags: ["Exams"],
      summary: "Delete an exam",
      params: examRef("examIdParamSchema"),
      response: { 200: examRef("examDeleteResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteExamHandler,
  });
}
