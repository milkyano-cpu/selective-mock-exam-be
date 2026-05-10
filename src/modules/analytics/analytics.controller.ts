import type { FastifyRequest, FastifyReply } from "fastify";
import { createHttpError } from "../../utils/http-error.js";
import type { LeaderboardQuery, StudentAnalyticsParams } from "./analytics.schema.js";
import { getMyAnalytics, getLeaderboard, getStudentAnalytics, getChildrenAnalytics } from "./analytics.service.js";

export async function getMyAnalyticsHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await getMyAnalytics(request.server.prisma, request.user.sub);
  return reply.send({ success: true, message: "OK", data });
}

export async function getLeaderboardHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as LeaderboardQuery;
  const data = await getLeaderboard(request.server.prisma, query, request.user.sub);
  return reply.send({ success: true, message: "OK", data });
}

export async function getStudentAnalyticsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { studentId } = request.params as StudentAnalyticsParams;
  const data = await getStudentAnalytics(request.server.prisma, studentId);
  if (!data) throw createHttpError(404, "Student not found");
  return reply.send({ success: true, message: "OK", data });
}

export async function getChildrenAnalyticsHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await getChildrenAnalytics(request.server.prisma, request.user.sub);
  return reply.send({ success: true, message: "OK", data });
}
