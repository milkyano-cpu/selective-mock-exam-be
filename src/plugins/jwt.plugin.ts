import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";

async function jwtPlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  fastify.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();

        // A valid session requires the jti to exist in refresh_tokens and not be revoked.
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
      } catch {
        return reply.status(401).send({
          success: false,
          message: "Invalid or expired access token",
          statusCode: 401,
        });
      }
    }
  );
}

export default fp(jwtPlugin, {
  name: "jwt",
  dependencies: ["prisma"],
});
