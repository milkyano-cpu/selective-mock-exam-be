import fp from "fastify-plugin";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

async function rateLimitPlugin(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: false,
    redis: fastify.redis,
    // Identify clients by IP. trustProxy is set in app.ts so X-Forwarded-For is honored.
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      success: false,
      message: `Too many requests. Please try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      statusCode: 429,
    }),
    onExceeded: (request) => {
      request.log.warn({ ip: request.ip, url: request.url }, "Rate limit exceeded");
    },
  });
}

export default fp(rateLimitPlugin, {
  name: "rate-limit",
  dependencies: ["redis"],
});
