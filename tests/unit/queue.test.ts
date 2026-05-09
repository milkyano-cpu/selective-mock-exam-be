import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const queueConstructorMock = jest.fn();

jest.unstable_mockModule("bullmq", () => ({
  Queue: queueConstructorMock,
}));

const { getQueue } = await import("../../src/lib/queue.js");

describe("queue helper", () => {
  beforeEach(() => {
    queueConstructorMock.mockClear();
    queueConstructorMock.mockImplementation(function Queue(this: { name: string; options: unknown }, name: string, options: unknown) {
      this.name = name;
      this.options = options;
    });
  });

  it("creates a BullMQ queue with the provided Redis connection", () => {
    const redis = { id: "redis-1" };

    const queue = getQueue("grading", redis as never);

    expect(queueConstructorMock).toHaveBeenCalledWith("grading", { connection: redis });
    expect(queue).toMatchObject({
      name: "grading",
      options: { connection: redis },
    });
  });

  it("reuses an existing queue for the same queue name", () => {
    const firstRedis = { id: "redis-first" };
    const secondRedis = { id: "redis-second" };

    const firstQueue = getQueue("analytics", firstRedis as never);
    const secondQueue = getQueue("analytics", secondRedis as never);

    expect(secondQueue).toBe(firstQueue);
    expect(queueConstructorMock).toHaveBeenCalledTimes(1);
    expect(queueConstructorMock).toHaveBeenCalledWith("analytics", { connection: firstRedis });
  });

  it("creates separate queues for different queue names", () => {
    const redis = { id: "redis-1" };

    const feedbackQueue = getQueue("ai-feedback", redis as never);
    const leaderboardQueue = getQueue("leaderboard", redis as never);

    expect(feedbackQueue).not.toBe(leaderboardQueue);
    expect(queueConstructorMock).toHaveBeenCalledTimes(2);
    expect(queueConstructorMock).toHaveBeenNthCalledWith(1, "ai-feedback", { connection: redis });
    expect(queueConstructorMock).toHaveBeenNthCalledWith(2, "leaderboard", { connection: redis });
  });
});
