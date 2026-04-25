import { Worker } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import { getQueue } from "../../lib/queue.js";
import type { ObjectStorage } from "../../lib/object-storage.js";

export type ProfilePhotoCleanupReason =
  | "previous-photo-replacement-failure"
  | "upload-rollback-failure";

export type ProfilePhotoCleanupJobData = {
  key: string;
  userId: string;
  reason: ProfilePhotoCleanupReason;
};

const PROFILE_PHOTO_CLEANUP_QUEUE_NAME = "storage-cleanup";

export async function enqueueProfilePhotoCleanup(
  redis: Redis,
  logger: FastifyBaseLogger,
  data: ProfilePhotoCleanupJobData
) {
  try {
    const queue = getQueue(PROFILE_PHOTO_CLEANUP_QUEUE_NAME, redis);
    await queue.add("delete-profile-photo", data, {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: 100,
      removeOnFail: 1000,
    });
  } catch (error) {
    logger.error(
      {
        error,
        orphanProfilePhotoKey: data.key,
        userId: data.userId,
        reason: data.reason,
      },
      "Failed to enqueue orphaned profile photo cleanup job"
    );
  }
}

export function createProfilePhotoCleanupWorker(
  redis: Redis,
  storage: ObjectStorage,
  logger: FastifyBaseLogger
) {
  const worker = new Worker<ProfilePhotoCleanupJobData>(
    PROFILE_PHOTO_CLEANUP_QUEUE_NAME,
    async (job) => {
      await storage.deleteProfilePhoto(job.data.key);
    },
    {
      connection: redis,
      concurrency: 2,
    }
  );

  worker.on("failed", (job, error) => {
    logger.error(
      {
        error,
        jobId: job?.id,
        orphanProfilePhotoKey: job?.data.key,
        userId: job?.data.userId,
        reason: job?.data.reason,
      },
      "Orphaned profile photo cleanup job failed"
    );
  });

  return worker;
}
