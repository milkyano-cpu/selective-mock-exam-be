import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  StartPracticeBody,
  StartWeakAreaPracticeBody,
  GetRecommendationsQuery,
  SubmitPracticeBody,
  ListPracticeSessionsQuery,
  CreateAssignmentBody,
  ListAssignmentsQuery,
} from "./practice.schema.js";
import {
  startPracticeSession,
  startWeakAreaPracticeSession,
  getWeakAreaRecommendations,
  getMyPracticeAccess,
  getPracticeSession,
  submitPracticeSession,
  listPracticeSessions,
  createTutorAssignment,
  listTutorAssignments,
} from "./practice.service.js";

export async function getPracticeAccessHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const data = await getMyPracticeAccess(request.server.prisma, request.user.sub);
  return reply.send({ success: true, message: "Practice access retrieved", data });
}

export async function startPracticeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as StartPracticeBody;
  const data = await startPracticeSession(request.server.prisma, request.user.sub, body);
  return reply.status(201).send({ success: true, message: "Practice session started", data });
}

export async function startWeakAreaPracticeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as StartWeakAreaPracticeBody;
  const data = await startWeakAreaPracticeSession(request.server.prisma, request.user.sub, body);
  return reply.status(201).send({ success: true, message: "Weak-area practice session started", data });
}

export async function getRecommendationsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as GetRecommendationsQuery;
  const data = await getWeakAreaRecommendations(request.server.prisma, request.user.sub, query);
  return reply.send({ success: true, message: "Recommendations retrieved", data });
}

export async function getPracticeSessionHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { sessionId } = request.params as { sessionId: string };
  const data = await getPracticeSession(request.server.prisma, sessionId, request.user.sub);
  return reply.send({ success: true, message: "Practice session retrieved", data });
}

export async function submitPracticeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { sessionId } = request.params as { sessionId: string };
  const body = request.body as SubmitPracticeBody;
  const data = await submitPracticeSession(request.server.prisma, sessionId, request.user.sub, body);
  return reply.send({ success: true, message: "Practice session completed", data });
}

export async function listPracticeSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListPracticeSessionsQuery;
  const result = await listPracticeSessions(request.server.prisma, request.user.sub, query);
  return reply.send({ success: true, message: "Practice sessions retrieved", ...result });
}

export async function createTutorAssignmentHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as CreateAssignmentBody;
  const data = await createTutorAssignment(request.server.prisma, request.user.sub, body);
  return reply.status(201).send({ success: true, message: "Practice assignment created", data });
}

export async function listTutorAssignmentsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListAssignmentsQuery;
  const result = await listTutorAssignments(request.server.prisma, request.user.sub, query);
  return reply.send({ success: true, message: "Assignments retrieved", ...result });
}
