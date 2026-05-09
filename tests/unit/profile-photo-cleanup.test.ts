import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const queueAddMock = jest.fn();
const getQueueMock = jest.fn(() => ({ add: queueAddMock }));

type FailedHandler = (job: { id?: string; data: Record<string, unknown> } | undefined, error: Error) => void;
const workerInstance = {
  on: jest.fn(),
  close: jest.fn(),
};
const WorkerMock = jest.fn((_queueName: string, processor: unknown, _options: unknown) => {
  return { ...workerInstance, processor };
});

jest.unstable_mockModule("../../src/lib/queue.js", () => ({ getQueue: getQueueMock }));
jest.unstable_mockModule("bullmq", () => ({ Worker: WorkerMock }));
jest.unstable_mockModule("fastify-plugin", () => ({ default: (plugin: unknown) => plugin }));

const cleanup = await import("../../src/modules/users/profile-photo-cleanup.js");
const profilePhotoCleanupPlugin = (await import("../../src/plugins/profile-photo-cleanup.plugin.js")).default as (
  fastify: ReturnType<typeof fakeFastify>
) => Promise<void>;

function fakeLogger() {
  return {
    error: jest.fn(),
    info: jest.fn(),
  };
}

function fakeFastify() {
  return {
    redis: { id: "redis" },
    storage: { deleteProfilePhoto: jest.fn(async () => undefined) },
    log: fakeLogger(),
    addHook: jest.fn(),
  };
}

describe("profile photo cleanup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queueAddMock.mockResolvedValue({ id: "job-1" } as never);
    getQueueMock.mockReturnValue({ add: queueAddMock });
    workerInstance.close.mockResolvedValue(undefined as never);
  });

  it("enqueues orphaned profile photo cleanup jobs with retry policy", async () => {
    const logger = fakeLogger();
    const redis = { id: "redis" };

    await cleanup.enqueueProfilePhotoCleanup(redis as never, logger as never, {
      key: "profiles/user-1.png",
      userId: "user-1",
      reason: "upload-rollback-failure",
    });

    expect(getQueueMock).toHaveBeenCalledWith("storage-cleanup", redis);
    expect(queueAddMock).toHaveBeenCalledWith(
      "delete-profile-photo",
      {
        key: "profiles/user-1.png",
        userId: "user-1",
        reason: "upload-rollback-failure",
      },
      {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      }
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs enqueue failures without throwing", async () => {
    const logger = fakeLogger();
    const error = new Error("Queue down");
    queueAddMock.mockRejectedValueOnce(error as never);

    await cleanup.enqueueProfilePhotoCleanup({} as never, logger as never, {
      key: "profiles/user-1.png",
      userId: "user-1",
      reason: "previous-photo-replacement-failure",
    });

    expect(logger.error).toHaveBeenCalledWith(
      {
        error,
        orphanProfilePhotoKey: "profiles/user-1.png",
        userId: "user-1",
        reason: "previous-photo-replacement-failure",
      },
      "Failed to enqueue orphaned profile photo cleanup job"
    );
  });

  it("creates a worker that deletes profile photos and logs failed jobs", async () => {
    const logger = fakeLogger();
    const storage = { deleteProfilePhoto: jest.fn(async () => undefined) };
    const worker = cleanup.createProfilePhotoCleanupWorker({ id: "redis" } as never, storage as never, logger as never) as {
      processor: (job: { data: { key: string } }) => Promise<void>;
      on: jest.Mock;
    };

    await worker.processor({ data: { key: "profiles/user-1.png" } });
    const failedHandler = worker.on.mock.calls[0]?.[1] as FailedHandler;
    const error = new Error("Delete failed");
    failedHandler(
      {
        id: "job-1",
        data: {
          key: "profiles/user-1.png",
          userId: "user-1",
          reason: "upload-rollback-failure",
        },
      },
      error
    );
    failedHandler(undefined, error);

    expect(WorkerMock).toHaveBeenCalledWith("storage-cleanup", expect.any(Function), {
      connection: { id: "redis" },
      concurrency: 2,
    });
    expect(storage.deleteProfilePhoto).toHaveBeenCalledWith("profiles/user-1.png");
    expect(worker.on).toHaveBeenCalledWith("failed", expect.any(Function));
    expect(logger.error).toHaveBeenCalledWith(
      {
        error,
        jobId: "job-1",
        orphanProfilePhotoKey: "profiles/user-1.png",
        userId: "user-1",
        reason: "upload-rollback-failure",
      },
      "Orphaned profile photo cleanup job failed"
    );
    expect(logger.error).toHaveBeenCalledWith(
      {
        error,
        jobId: undefined,
        orphanProfilePhotoKey: undefined,
        userId: undefined,
        reason: undefined,
      },
      "Orphaned profile photo cleanup job failed"
    );
  });

  it("registers the cleanup worker plugin and closes the worker on shutdown", async () => {
    const fastify = fakeFastify();

    await profilePhotoCleanupPlugin(fastify);
    const closeHook = fastify.addHook.mock.calls[0]?.[1] as () => Promise<void>;
    await closeHook();

    expect(fastify.addHook).toHaveBeenCalledWith("onClose", expect.any(Function));
    expect(workerInstance.close).toHaveBeenCalled();
  });
});
