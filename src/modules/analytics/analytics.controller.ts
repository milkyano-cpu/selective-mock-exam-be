import type { FastifyRequest, FastifyReply } from "fastify";
import { createHttpError } from "../../utils/http-error.js";
import { getFreshUserTier } from "../../utils/membership.js";
import type { LeaderboardQuery, StudentAnalyticsParams } from "./analytics.schema.js";
import {
  getMyAnalytics,
  getLeaderboard,
  getStudentAnalytics,
  getChildrenAnalytics,
  serializeAnalyticsForTier,
} from "./analytics.service.js";

export async function getMyAnalyticsHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await getMyAnalytics(request.server.prisma, request.user.sub);
  const tier = await getFreshUserTier(request.server.prisma, request.user.sub);
  return reply.send({ success: true, message: "OK", data: serializeAnalyticsForTier(data, tier) });
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
  const tier = await getFreshUserTier(request.server.prisma, studentId);
  return reply.send({ success: true, message: "OK", data: serializeAnalyticsForTier(data, tier) });
}

export async function getChildrenAnalyticsHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await getChildrenAnalytics(request.server.prisma, request.user.sub);
  const serializedData = await Promise.all(
    data.map(async (child) => {
      const tier = await getFreshUserTier(request.server.prisma, child.studentId);
      return serializeAnalyticsForTier(child, tier);
    })
  );
  return reply.send({ success: true, message: "OK", data: serializedData });
}
