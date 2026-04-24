import type { FastifyRequest, FastifyReply } from "fastify";
import { checkDbConnection } from "./health.service.js";

export async function healthCheck(request: FastifyRequest, reply: FastifyReply) {
  const dbStatus = await checkDbConnection(request.server.prisma);
  const isHealthy = dbStatus === "connected";
  const statusCode = isHealthy ? 200 : 503;

  return reply.status(statusCode).send({
    success: isHealthy,
    message: isHealthy ? "Aspire API is running" : "Service degraded",
    data: {
      status: isHealthy ? "ok" : "degraded",
      db: dbStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env["NODE_ENV"] ?? "development",
    },
  });
}
