import type { FastifyRequest, FastifyReply } from "fastify";
import { getQueue } from "../../lib/queue.js";
import type {
  CreateExamBody,
  UpdateExamBody,
  ListExamsQuery,
  PublishExamBody,
  AddExamQuestionsBody,
  SubmitAnswerBody,
  BatchAnswersBody,
  SubmitSessionBody,
  SessionHeartbeatBody,
  ListSessionsQuery,
  ExamSubmissionsQuery,
  SubmitManualGradesBody,
  StartRetakeBody,
} from "./exams.schema.js";
import {
  createExamRecord,
  listExams,
  updateExamRecord,
  deleteExamRecord,
  publishExamRecord,
  getExamWithQuestions,
  addQuestionsToExam,
  removeQuestionFromExam,
  startOrResumeSession,
  startRetakeSession,
  getExamAttemptSummary,
  upsertAnswer,
  batchUpsertAnswers,
  recordSessionHeartbeat,
  submitExamSession,
  getSessionResult,
  listStudentSessions,
  listExamSubmissions,
  getReviewSession,
  submitManualGrades,
  getSessionInsights,
} from "./exams.service.js";

// ── Exam CRUD ─────────────────────────────────────────────────────────────────

export async function createExamHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateExamBody;
  const exam = await createExamRecord(request.server.prisma, request.user.sub, body);
  return reply.status(201).send({ success: true, message: "Exam created", data: exam });
}

export async function listExamsHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListExamsQuery;
  const result = await listExams(request.server.prisma, query, request.user.role);
  return reply.send({ success: true, message: "Exams retrieved", ...result });
}

export async function publishExamHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as PublishExamBody;
  const exam = await publishExamRecord(request.server.prisma, id, body);
  return reply.send({ success: true, message: body.status === "PUBLISHED" ? "Exam published" : "Exam unpublished", data: exam });
}

export async function getExamWithQuestionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as { id: string };
  const data = await getExamWithQuestions(request.server.prisma, id);
  return reply.send({ success: true, message: "Exam retrieved", data });
}

export async function updateExamHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as UpdateExamBody;
  const exam = await updateExamRecord(request.server.prisma, id, body);
  return reply.send({ success: true, message: "Exam updated", data: exam });
}

export async function deleteExamHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await deleteExamRecord(request.server.prisma, id);
  return reply.send({ success: true, message: "Exam deleted" });
}

// ── Exam Questions ────────────────────────────────────────────────────────────

export async function addExamQuestionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as { id: string };
  const body = request.body as AddExamQuestionsBody;
  const questions = await addQuestionsToExam(request.server.prisma, id, body);
  return reply.status(201).send({ success: true, message: "Questions added to exam", data: questions });
}

export async function removeExamQuestionHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id, questionId } = request.params as { id: string; questionId: string };
  await removeQuestionFromExam(request.server.prisma, id, questionId);
  return reply.send({ success: true, message: "Question removed from exam" });
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function listSessionsHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListSessionsQuery;
  const result = await listStudentSessions(
    request.server.prisma,
    request.user.sub,
    query
  );
  return reply.send({ success: true, message: "Sessions retrieved", ...result });
}

export async function startSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const data = await startOrResumeSession(
    request.server.prisma,
    id,
    request.user.sub
  );
  const isNew = data.answeredCount === 0;
  return reply.status(isNew ? 201 : 200).send({
    success: true,
    message: isNew ? "Exam session started" : "Exam session resumed",
    data,
  });
}

export async function getSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = request.params as { sessionId: string };
  // Re-use startOrResumeSession to fetch session with questions
  // But we need to find the examId first
  const session = await request.server.prisma.examSession.findUnique({
    where: { id: sessionId },
    select: { examId: true, studentId: true, status: true },
  });
  if (!session) {
    return reply.status(404).send({ success: false, message: "Session not found", statusCode: 404 });
  }
  if (session.studentId !== request.user.sub) {
    return reply.status(403).send({ success: false, message: "Forbidden", statusCode: 403 });
  }
  if (session.status !== "IN_PROGRESS") {
    return reply.status(400).send({
      success: false,
      message: "Session is not in progress. Use the result endpoint to view results.",
      statusCode: 400,
    });
  }

  const data = await startOrResumeSession(
    request.server.prisma,
    session.examId,
    request.user.sub
  );
  return reply.send({ success: true, message: "Session retrieved", data });
}

export async function submitAnswerHandler(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = request.params as { sessionId: string };
  const body = request.body as SubmitAnswerBody;
  const data = await upsertAnswer(
    request.server.prisma,
    sessionId,
    request.user.sub,
    body
  );
  return reply.send({ success: true, message: "Answer saved", data });
}

export async function batchAnswersHandler(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = request.params as { sessionId: string };
  const body = request.body as BatchAnswersBody;
  const data = await batchUpsertAnswers(
    request.server.prisma,
    sessionId,
    request.user.sub,
    body
  );
  return reply.send({ success: true, message: "Answers saved", data });
}

export async function sessionHeartbeatHandler(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = request.params as { sessionId: string };
  const body = request.body as SessionHeartbeatBody;
  const data = await recordSessionHeartbeat(
    request.server.prisma,
    sessionId,
    request.user.sub,
    body
  );

  return reply.send({ success: true, message: data.expired ? "Exam time has expired" : "Session heartbeat recorded", data });
}

export async function submitSessionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = request.params as { sessionId: string };
  const body = request.body as SubmitSessionBody;
  const data = await submitExamSession(
    request.server.prisma,
    sessionId,
    request.user.sub,
    body
  );

  // Enqueue grading job
  const gradingQueue = getQueue("grading", request.server.redis);
  await gradingQueue.add(
    "grade-session",
    { sessionId },
    { attempts: 3, backoff: { type: "exponential", delay: 2000 } }
  );

  request.log.info({ sessionId }, "Grading job enqueued");

  return reply.send({ success: true, message: "Exam submitted", data });
}

export async function getSessionResultHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { sessionId } = request.params as { sessionId: string };
  const data = await getSessionResult(
    request.server.prisma,
    sessionId,
    request.user.sub
  );
  return reply.send({ success: true, message: "Results retrieved", data });
}

export async function listExamSubmissionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as { id: string };
  const query = request.query as ExamSubmissionsQuery;
  const result = await listExamSubmissions(request.server.prisma, id, query);
  return reply.send({ success: true, message: "Exam submissions retrieved", ...result });
}

export async function getReviewSessionHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { sessionId } = request.params as { sessionId: string };
  const data = await getReviewSession(request.server.prisma, sessionId);
  return reply.send({ success: true, message: "Review session retrieved", data });
}

export async function submitManualGradesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { sessionId } = request.params as { sessionId: string };
  const body = request.body as SubmitManualGradesBody;
  const data = await submitManualGrades(request.server.prisma, sessionId, body, request.user.sub);
  return reply.send({ success: true, message: "Manual grades saved", data });
}

export async function getSessionInsightsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { sessionId } = request.params as { sessionId: string };
  const data = await getSessionInsights(request.server.prisma, sessionId, request.user.sub);
  return reply.send({ success: true, message: "AI Insights generated successfully", data });
}

// ── Retake & Attempt Summary ─────────────────────────────────────────────────

export async function startRetakeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as StartRetakeBody;
  const data = await startRetakeSession(
    request.server.prisma,
    id,
    request.user.sub,
    body
  );
  return reply.status(201).send({ success: true, message: "Retake session started", data });
}

export async function getExamAttemptSummaryHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as { id: string };
  const data = await getExamAttemptSummary(
    request.server.prisma,
    id,
    request.user.sub
  );
  return reply.send({ success: true, message: "Attempt summary retrieved", data });
}
