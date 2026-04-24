import { randomUUID } from "crypto";
import Fastify, { type FastifyError } from "fastify";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { mapPrismaError } from "./utils/prisma-errors.js";

// Plugins
import prismaPlugin from "./plugins/prisma.plugin.js";
import jwtPlugin from "./plugins/jwt.plugin.js";
import securityPlugin from "./plugins/security.plugin.js";
import tracePlugin from "./plugins/trace.plugin.js";
import redisPlugin from "./plugins/redis.plugin.js";
import rateLimitPlugin from "./plugins/rate-limit.plugin.js";
import cleanupPlugin from "./plugins/cleanup.plugin.js";

// Routes
import { healthRoutes } from "./modules/health/health.route.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { usersRoutes } from "./modules/users/users.route.js";
import { adminRoutes } from "./modules/admin/admin.route.js";

// Schemas
import { authSchemas } from "./modules/auth/auth.schema.js";
import { userSchemas } from "./modules/users/users.schema.js";
import { healthSchemas } from "./modules/health/health.schema.js";
import { adminSchemas } from "./modules/admin/admin.schema.js";

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    requestIdLogLabel: "traceId",
    genReqId: (req) => (req.headers["x-trace-id"] as string) ?? randomUUID(),
    trustProxy: true,
  });

  // ─── Plugins (order matters) ─────────────────────────────────────
  await app.register(securityPlugin);   // CORS + Helmet
  await app.register(tracePlugin);      // Trace ID
  await app.register(redisPlugin);      // Redis connection
  await app.register(rateLimitPlugin);  // Rate limit (global: false, per-route opt-in)
  await app.register(prismaPlugin);     // Database
  await app.register(jwtPlugin);        // JWT
  await app.register(cleanupPlugin);    // Expired token cleanup

  // ─── Register JSON Schemas (must be before routes) ───────────────
  for (const schema of [
    ...authSchemas,
    ...userSchemas,
    ...healthSchemas,
    ...adminSchemas,
  ]) {
    app.addSchema(schema);
  }

  // ─── Routes ──────────────────────────────────────────────────────
  // Health (no prefix)
  await app.register(healthRoutes);

  // API routes with prefix
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(usersRoutes, { prefix: "/users" });
      await api.register(adminRoutes, { prefix: "/admin" });
    },
    { prefix: env.API_PREFIX }
  );

  // ─── Global error handler ─────────────────────────────────────────
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const normalizedError = mapPrismaError(error) ?? error;
    const statusCode = normalizedError.statusCode ?? 500;

    // Only log unexpected server errors — 4xx are client mistakes, not bugs
    if (statusCode >= 500) {
      app.log.error(normalizedError);
    }

    return reply.status(statusCode).send({
      success: false,
      message: statusCode >= 500 ? "Internal Server Error" : normalizedError.message,
      statusCode,
    });
  });

  // ─── 404 Handler ─────────────────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      success: false,
      message: "Route not found",
      statusCode: 404,
    });
  });

  return app;
}
