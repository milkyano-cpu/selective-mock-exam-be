import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { MultipartFile } from "@fastify/multipart";
import type { ObjectStorage } from "../lib/object-storage.js";
import type { JwtPayload } from "./common.js";

// Augment FastifyInstance with app-level decorators
declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    storage: ObjectStorage;
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }

  interface FastifyRequest {
    file(): Promise<MultipartFile | undefined>;
  }
}

// Augment @fastify/jwt so request.user is properly typed throughout the app
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
