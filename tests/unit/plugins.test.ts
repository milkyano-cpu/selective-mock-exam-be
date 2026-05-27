import { describe, expect, it, jest, afterEach } from "@jest/globals";
import cleanupPlugin from "../../src/plugins/cleanup.plugin.js";
import jwtPlugin from "../../src/plugins/jwt.plugin.js";
import rateLimitPlugin from "../../src/plugins/rate-limit.plugin.js";
import securityPlugin from "../../src/plugins/security.plugin.js";
import tracePlugin from "../../src/plugins/trace.plugin.js";

function mockReply() {
  return {
    header: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
}

describe("Fastify plugins", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("purges expired tokens and clears cleanup timer on close", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-08T00:00:00.000Z"));
    const onCloseHooks: Array<() => void> = [];
    const refreshDeleteMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 0 });
    const resetDeleteMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const fastify = {
      prisma: {
        refreshToken: { deleteMany: refreshDeleteMany },
        passwordResetToken: { deleteMany: resetDeleteMany },
        image: {
          findMany: jest.fn(async () => []),
          delete: jest.fn(),
        },
      },
      storage: { deleteObject: jest.fn(), bucket: "aspire-test" },
      log: { info: jest.fn(), error: jest.fn() },
      addHook: jest.fn((_name: string, hook: () => void) => onCloseHooks.push(hook)),
    };

    await cleanupPlugin(fastify as never, undefined as never);
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    onCloseHooks[0]!();

    expect(refreshDeleteMany).toHaveBeenCalledWith({
      where: { OR: [{ expiresAt: { lt: expect.any(Date) } }, { revokedAt: { not: null } }] },
    });
    expect(resetDeleteMany).toHaveBeenCalledWith({
      where: { OR: [{ expiresAt: { lt: expect.any(Date) } }, { usedAt: { not: null } }] },
    });
    expect(fastify.log.info).toHaveBeenCalledWith(
      { count: 2 },
      "Purged expired/revoked refresh tokens"
    );
    expect(fastify.log.info).toHaveBeenCalledWith(
      { count: 1 },
      "Purged expired/used password reset tokens"
    );
  });

  it("registers JWT and authenticates active sessions", async () => {
    let authenticate: (request: unknown, reply: unknown) => Promise<void>;
    const fastify = {
      register: jest.fn().mockResolvedValue(undefined),
      decorate: jest.fn((_name: string, value: typeof authenticate) => {
        authenticate = value;
      }),
      prisma: {},
    };

    await jwtPlugin(fastify as never, undefined as never);

    const reply = mockReply();
    const request = {
      jwtVerify: jest.fn().mockResolvedValue(undefined),
      user: { jti: "jti-1", sub: "user-1" },
      server: {
        prisma: {
          refreshToken: {
            findFirst: jest.fn().mockResolvedValue({
              id: "session-1",
              user: { status: "ACTIVE" },
            }),
          },
        },
      },
    };

    await authenticate!(request, reply);

    expect(fastify.register).toHaveBeenCalledWith(expect.any(Function), expect.any(Object));
    expect(request.server.prisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: {
        jti: "jti-1",
        userId: "user-1",
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true, user: { select: { status: true } } },
    });
    expect(reply.status).not.toHaveBeenCalled();
  });

  it("rejects invalidated JWT sessions", async () => {
    let authenticate: (request: unknown, reply: unknown) => Promise<void>;
    const fastify = {
      register: jest.fn().mockResolvedValue(undefined),
      decorate: jest.fn((_name: string, value: typeof authenticate) => {
        authenticate = value;
      }),
    };

    await jwtPlugin(fastify as never, undefined as never);

    const reply = mockReply();
    await authenticate!(
      {
        jwtVerify: jest.fn().mockResolvedValue(undefined),
        user: { jti: "jti-1", sub: "user-1" },
        server: { prisma: { refreshToken: { findFirst: jest.fn().mockResolvedValue(null) } } },
      },
      reply
    );

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Session has been invalidated. Please login again.",
      statusCode: 401,
    });
  });

  it("rejects inactive JWT users", async () => {
    let authenticate: (request: unknown, reply: unknown) => Promise<void>;
    const fastify = {
      register: jest.fn().mockResolvedValue(undefined),
      decorate: jest.fn((_name: string, value: typeof authenticate) => {
        authenticate = value;
      }),
    };
    await jwtPlugin(fastify as never, undefined as never);
    const reply = mockReply();

    await authenticate!(
      {
        jwtVerify: jest.fn().mockResolvedValue(undefined),
        user: { jti: "jti-1", sub: "user-1" },
        server: {
          prisma: {
            refreshToken: {
              findFirst: jest.fn().mockResolvedValue({
                id: "session-1",
                user: { status: "BANNED" },
              }),
            },
          },
        },
      },
      reply
    );

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Your account is BANNED. Please contact an admin.",
      statusCode: 403,
    });
  });

  it("rejects invalid JWT tokens", async () => {
    let authenticate: (request: unknown, reply: unknown) => Promise<void>;
    const fastify = {
      register: jest.fn().mockResolvedValue(undefined),
      decorate: jest.fn((_name: string, value: typeof authenticate) => {
        authenticate = value;
      }),
    };
    await jwtPlugin(fastify as never, undefined as never);
    const reply = mockReply();

    await authenticate!({ jwtVerify: jest.fn().mockRejectedValue(new Error("bad token")) }, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      message: "Invalid or expired access token",
      statusCode: 401,
    });
  });

  it("registers rate limiting with custom keying and responses", async () => {
    const fastify = {
      redis: {},
      register: jest.fn().mockResolvedValue(undefined),
    };

    await rateLimitPlugin(fastify as never, undefined as never);

    const options = fastify.register.mock.calls[0]![1];
    expect(options.global).toBe(false);
    expect(options.redis).toBe(fastify.redis);
    expect(options.keyGenerator({ ip: "127.0.0.1" })).toBe("127.0.0.1");
    expect(options.errorResponseBuilder({}, { ttl: 2100 })).toEqual({
      success: false,
      message: "Too many requests. Please try again in 3 seconds.",
      statusCode: 429,
    });
    const warn = jest.fn();
    options.onExceeded({ ip: "127.0.0.1", url: "/login", log: { warn } });
    expect(warn).toHaveBeenCalledWith(
      { ip: "127.0.0.1", url: "/login" },
      "Rate limit exceeded"
    );
  });

  it("registers security plugins with cookie, CORS, and helmet", async () => {
    const fastify = { register: jest.fn().mockResolvedValue(undefined) };

    await securityPlugin(fastify as never, undefined as never);

    expect(fastify.register).toHaveBeenCalledTimes(3);
    // call[0] — fastifyCookie (no options)
    expect(fastify.register.mock.calls[0]![1]).toBeUndefined();
    // call[1] — fastifyCors
    expect(fastify.register.mock.calls[1]![1]).toEqual({
      origin: expect.any(Array),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    });
    // call[2] — fastifyHelmet (no options)
    expect(fastify.register.mock.calls[2]![1]).toBeUndefined();
  });

  it("adds trace id response headers", async () => {
    let onRequest: (request: unknown, reply: unknown) => Promise<void>;
    const fastify = {
      addHook: jest.fn((_name: string, hook: typeof onRequest) => {
        onRequest = hook;
      }),
    };
    await tracePlugin(fastify as never, undefined as never);
    const reply = mockReply();

    await onRequest!({ id: "trace-1" }, reply);

    expect(fastify.addHook).toHaveBeenCalledWith("onRequest", expect.any(Function));
    expect(reply.header).toHaveBeenCalledWith("X-Trace-Id", "trace-1");
  });
});
