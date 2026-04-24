import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";

async function jwtPlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
    cookie: {
      cookieName: "access_token",
      signed: false,
    },
  });

  fastify.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      // Block 1: JWT signature & expiry check only.
      // A bad or expired token throws here → always a client error (401).
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({
          success: false,
          message: "Invalid or expired access token",
          statusCode: 401,
        });
      }

      // Block 2: DB session validation — outside try/catch so any Prisma error
      // bubbles up to the global error handler and becomes a 500, not a silent 401.
      // This is what makes logout and single-device enforcement take effect immediately.
      const session = await request.server.prisma.refreshToken.findFirst({
        where: {
          jti: request.user.jti,
          userId: request.user.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          user: { select: { status: true } },
        },
      });

      if (!session) {
        return reply.status(401).send({
          success: false,
          message: "Session has been invalidated. Please login again.",
          statusCode: 401,
        });
      }

      if (session.user.status !== "ACTIVE") {
        return reply.status(403).send({
          success: false,
          message: `Your account is ${session.user.status}. Please contact an admin.`,
          statusCode: 403,
        });
      }
    }
  );
}

export default fp(jwtPlugin, {
  name: "jwt",
  dependencies: ["prisma"],
});
