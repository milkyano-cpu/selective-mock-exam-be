import type { FastifyRequest, FastifyReply } from "fastify";
import { checkDbConnection } from "./health.service.js";

export async function healthCheck(request: FastifyRequest, reply: FastifyReply) {
  const dbStatus = await checkDbConnection(request.server.prisma);

  return reply.status(200).send({
    success: true,
    message: "Aspire API is running",
    data: {
      status: "ok",
      db: dbStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env["NODE_ENV"] ?? "development",
    },
  });
}
