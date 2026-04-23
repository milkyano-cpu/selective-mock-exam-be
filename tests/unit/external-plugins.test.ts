import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const prismaInstance = {
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
};
const PrismaClient = jest.fn().mockImplementation(() => prismaInstance);
const PrismaPg = jest.fn().mockImplementation((options) => ({ options }));

type RedisCallback = (...args: never[]) => void;
let redisMode: "ready" | "error" = "ready";
const redisInstance = {
  once: jest.fn((event: string, callback: RedisCallback) => {
    if (event === "ready" && redisMode === "ready") callback();
    if (event === "error" && redisMode === "error") callback(new Error("Redis down") as never);
    return redisInstance;
  }),
  quit: jest.fn().mockResolvedValue(undefined),
};
const Redis = jest.fn().mockImplementation(() => redisInstance);

// Mock env with a mutable object so we can change NODE_ENV
const mockEnv = {
  DATABASE_URL: "postgresql://user:pass@example.com/db?sslmode=require",
  REDIS_URL: "redis://localhost:6379",
  NODE_ENV: "development" as "development" | "production" | "test",
};

jest.unstable_mockModule("@prisma/client", () => ({ PrismaClient }));
jest.unstable_mockModule("@prisma/adapter-pg", () => ({ PrismaPg }));
jest.unstable_mockModule("ioredis", () => ({ Redis }));
jest.unstable_mockModule("../../src/config/env.js", () => ({
  env: mockEnv,
}));

const prismaPlugin = (await import("../../src/plugins/prisma.plugin.js")).default;
const redisPlugin = (await import("../../src/plugins/redis.plugin.js")).default;

function fakeFastify() {
  const onCloseHooks: Array<() => Promise<void>> = [];
  return {
    onCloseHooks,
    log: { info: jest.fn() },
    decorate: jest.fn(),
    addHook: jest.fn((_name: string, hook: () => Promise<void>) => onCloseHooks.push(hook)),
  };
}

describe("external resource plugins", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisMode = "ready";
    mockEnv.NODE_ENV = "development";
  });

  it("connects Prisma with normalized sslmode and disconnects on close (development)", async () => {
    const fastify = fakeFastify();

    await prismaPlugin(fastify as never, undefined as never);
    await fastify.onCloseHooks[0]!();

    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://user:pass@example.com/db?sslmode=verify-full",
    });
    expect(PrismaClient).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      log: ["warn", "error"],
    });
    expect(prismaInstance.$connect).toHaveBeenCalled();
    expect(fastify.decorate).toHaveBeenCalledWith("prisma", prismaInstance);
    expect(prismaInstance.$disconnect).toHaveBeenCalled();
    expect(fastify.log.info).toHaveBeenCalledWith("Prisma disconnected");
  });

  it("uses error-only logging in production environment", async () => {
    mockEnv.NODE_ENV = "production";
    const fastify = fakeFastify();

    await prismaPlugin(fastify as never, undefined as never);

    expect(PrismaClient).toHaveBeenCalledWith({
      adapter: expect.any(Object),
      log: ["error"],
    });
  });

  it("connects Redis and disconnects on close", async () => {
    const fastify = fakeFastify();

    await redisPlugin(fastify as never, undefined as never);
    await fastify.onCloseHooks[0]!();

    expect(Redis).toHaveBeenCalledWith("redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    expect(fastify.decorate).toHaveBeenCalledWith("redis", redisInstance);
    expect(redisInstance.quit).toHaveBeenCalled();
    expect(fastify.log.info).toHaveBeenCalledWith("Redis disconnected");
  });

  it("rejects Redis plugin registration when connection errors", async () => {
    redisMode = "error";

    await expect(redisPlugin(fakeFastify() as never, undefined as never)).rejects.toThrow(
      "Redis down"
    );
  });
});
