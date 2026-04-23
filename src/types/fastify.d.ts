import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { JwtPayload } from "./common.js";

// Augment FastifyInstance with app-level decorators
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

// Augment @fastify/jwt so request.user is properly typed throughout the app
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
