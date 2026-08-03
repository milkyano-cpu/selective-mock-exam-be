import type { FastifyRequest, FastifyReply } from "fastify";
import { checkDbConnection } from "./health.service.js";

/**
 * Liveness probe — process is up and answering. Never touches the database.
 *
 * The container healthcheck polls this every 30s. Any query here would keep the
 * Neon compute from auto-suspending, so the instance gets billed around the
 * clock even with no traffic. Use GET /health/deep to verify dependencies.
 */
export async function healthCheck(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send({
    success: true,
    message: "Aspire API is running",
    data: {
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env["NODE_ENV"] ?? "development",
    },
  });
}

/**
 * Readiness/dependency probe — verifies the database is reachable.
 *
 * Called manually, or by monitoring on a slow interval. Do NOT wire this to the
 * container healthcheck; see healthCheck above for why.
 */
export async function deepHealthCheck(request: FastifyRequest, reply: FastifyReply) {
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
