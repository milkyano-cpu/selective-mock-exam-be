import { describe, expect, it, jest } from "@jest/globals";
import { healthCheck } from "../../src/modules/health/health.controller.js";
import { checkDbConnection } from "../../src/modules/health/health.service.js";

function mockReply() {
  const reply = {
    status: jest.fn<(code: number) => typeof reply>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.status.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

describe("health module", () => {
  it("reports connected when the database query succeeds", async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ result: 1 }]),
    };

    await expect(checkDbConnection(prisma as never)).resolves.toBe("connected");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("reports disconnected when the database query fails", async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => {
        throw new Error("database unavailable");
      }),
    };

    await expect(checkDbConnection(prisma as never)).resolves.toBe("disconnected");
  });

  it("sends an ok health response when dependencies are healthy", async () => {
    const request = {
      server: {
        prisma: {
          $queryRaw: jest.fn(async () => [{ result: 1 }]),
        },
      },
    };
    const reply = mockReply();

    const response = await healthCheck(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(response).toMatchObject({
      success: true,
      message: "Aspire API is running",
      data: {
        status: "ok",
        db: "connected",
      },
    });
    expect(response).toHaveProperty("data.uptime");
    expect(response).toHaveProperty("data.timestamp");
    expect(response).toHaveProperty("data.environment");
  });

  it("sends a degraded health response when the database is unavailable", async () => {
    const request = {
      server: {
        prisma: {
          $queryRaw: jest.fn(async () => {
            throw new Error("database unavailable");
          }),
        },
      },
    };
    const reply = mockReply();

    const response = await healthCheck(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(response).toMatchObject({
      success: false,
      message: "Service degraded",
      data: {
        status: "degraded",
        db: "disconnected",
      },
    });
  });
});
