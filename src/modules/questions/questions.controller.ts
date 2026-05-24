import type { FastifyRequest, FastifyReply } from "fastify";
import { createHttpError } from "../../utils/http-error.js";
import { notifyAdmins } from "../../lib/notify.js";
import type { BulkSubmitBody, CreateQuestionBody, ListQuestionsQuery, NextQuestionIdQuery, RejectQuestionBody, ResolveImportBody, UpdateQuestionBody } from "./questions.schema.js";
import {
  createQuestion,
  listQuestions,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
  submitQuestion,
  bulkSubmitQuestions,
  approveQuestion,
  rejectQuestion,
  bulkImportQuestions,
  resolveAndSavePendingRows,
  getNextQuestionId,
} from "./questions.service.js";

export async function getNextQuestionIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as NextQuestionIdQuery;
  const result = await getNextQuestionId(request.server.prisma, query.subjectId);

  return reply.send({
    success: true,
    data: result,
  });
}

export async function createQuestionHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateQuestionBody;
  const question = await createQuestion(request.server.prisma, body, request.user.sub);

  request.log.info({ questionId: question.id, createdBy: request.user.sub }, "Question created");

  return reply.status(201).send({
    success: true,
    message: "Question created successfully",
    data: question,
  });
}

export async function listQuestionsHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListQuestionsQuery;
  // Students may only see published questions
  const effectiveQuery: ListQuestionsQuery =
    request.user.role === "STUDENT" ? { ...query, status: "PUBLISHED" } : query;
  const result = await listQuestions(request.server.prisma, effectiveQuery);

  return reply.send({
    success: true,
    message: "Questions retrieved successfully",
    ...result,
  });
}

export async function getQuestionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const question = await getQuestionById(request.server.prisma, id);

  return reply.send({
    success: true,
    message: "Question retrieved successfully",
    data: question,
  });
}

export async function updateQuestionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as UpdateQuestionBody;
  const question = await updateQuestion(request.server.prisma, id, body);

  request.log.info({ questionId: id, updatedBy: request.user.sub }, "Question updated");

  return reply.send({
    success: true,
    message: "Question updated successfully",
    data: question,
  });
}

export async function deleteQuestionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await deleteQuestion(request.server.prisma, id, request.user.role);

  request.log.info({ questionId: id, deletedBy: request.user.sub }, "Question deleted");

  return reply.send({
    success: true,
    message: "Question deleted successfully",
  });
}

export async function submitQuestionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const question = await submitQuestion(request.server.prisma, id);

  request.log.info({ questionId: id, submittedBy: request.user.sub }, "Question submitted for review");

  // Notify all admins about the pending question
  notifyAdmins(request.server.prisma, {
    type: "QUESTION_PENDING_APPROVAL",
    title: "Question Pending Approval",
    message: `Question ${question.questionId ?? id} has been submitted for review.`,
    data: {
      questionId: id,
      questionDisplayId: question.questionId,
      subjectName: question.subjectName,
      submittedBy: request.user.sub,
      url: "/dashboard/questions?status=PENDING_APPROVAL",
    },
  }).catch((err) => request.log.error(err, "Failed to send admin notifications"));

  return reply.send({
    success: true,
    message: "Question submitted for review",
    data: question,
  });
}

export async function bulkSubmitQuestionsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { ids } = request.body as BulkSubmitBody;
  const result = await bulkSubmitQuestions(request.server.prisma, ids);

  request.log.info(
    { submitted: result.submitted, failed: result.failed, submittedBy: request.user.sub },
    "Bulk question submit"
  );

  if (result.submittedIds.length > 0) {
    notifyAdmins(request.server.prisma, {
      type: "QUESTION_PENDING_APPROVAL",
      title: "Questions Pending Approval",
      message: `${result.submitted} question(s) have been submitted for review.`,
      data: {
        submittedCount: result.submitted,
        submittedBy: request.user.sub,
        url: "/dashboard/questions?status=PENDING_APPROVAL",
      },
    }).catch((err) => request.log.error(err, "Failed to send admin notifications"));
  }

  return reply.send({
    success: true,
    message: `${result.submitted} question(s) submitted for review`,
    data: result,
  });
}

export async function approveQuestionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const question = await approveQuestion(request.server.prisma, id);

  request.log.info({ questionId: id, approvedBy: request.user.sub }, "Question approved and published");

  return reply.send({
    success: true,
    message: "Question approved and published",
    data: question,
  });
}

export async function rejectQuestionHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as RejectQuestionBody;
  const question = await rejectQuestion(request.server.prisma, id, body.rejectionNote);

  request.log.info({ questionId: id, rejectedBy: request.user.sub }, "Question rejected");

  return reply.send({
    success: true,
    message: "Question rejected and returned to draft",
    data: question,
  });
}

export async function bulkImportQuestionsHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await request.file();

  if (!data) throw createHttpError(400, "No file uploaded");

  if (!data.filename.endsWith(".csv")) {
    throw createHttpError(400, "Uploaded file must be a CSV");
  }

  const buffer = await data.toBuffer();
  const result = await bulkImportQuestions(request.server.prisma, buffer, request.user.sub);

  request.log.info(
    { importedBy: request.user.sub, total: result.total, created: result.created, skipped: result.skipped, failed: result.failed },
    "Bulk CSV question import completed",
  );

  return reply.send({
    success: true,
    message: "Bulk import completed",
    data: result,
  });
}

export async function resolveImportHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as ResolveImportBody;
  const result = await resolveAndSavePendingRows(request.server.prisma, body.rows, request.user.sub);

  request.log.info(
    { resolvedBy: request.user.sub, saved: result.saved, stillUnresolved: result.stillUnresolved.length },
    "Pending import rows resolved",
  );

  return reply.send({
    success: true,
    message: "Pending rows resolved",
    data: result,
  });
}

