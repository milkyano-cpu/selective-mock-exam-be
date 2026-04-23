import { Redis } from "ioredis";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

async function redisPlugin(fastify: FastifyInstance) {
  const redis = new Redis(env.REDIS_URL, {
    // Required by @fastify/rate-limit — it runs custom commands that throw
    // if maxRetriesPerRequest is set. See: fastify/fastify-rate-limit#397
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  await new Promise<void>((resolve, reject) => {
    redis.once("ready", () => resolve());
    redis.once("error", (err: Error) => reject(err));
  });

  fastify.log.info("Redis connected");

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async () => {
    await redis.quit();
    fastify.log.info("Redis disconnected");
  });
}

export default fp(redisPlugin, {
  name: "redis",
});
