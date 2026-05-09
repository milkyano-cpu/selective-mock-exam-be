import { Worker } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import { sendAnnouncement } from "./announcements.service.js";

export interface BroadcastJobData {
  announcementId: string;
}

export function createBroadcastWorker(
  redis: Redis,
  prisma: PrismaClient,
  logger: FastifyBaseLogger
) {
  const worker = new Worker<BroadcastJobData>(
    "broadcast",
    async (job) => {
      logger.info(
        { announcementId: job.data.announcementId, jobId: job.id },
        "Processing scheduled broadcast"
      );
      const result = await sendAnnouncement(prisma, job.data.announcementId);
      if (!result) {
        logger.warn(
          { announcementId: job.data.announcementId },
          "Announcement not found or already sent"
        );
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, announcementId: job?.data?.announcementId, err },
      "Broadcast job failed"
    );
  });

  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, announcementId: job.data.announcementId },
      "Broadcast job completed"
    );
  });

  return worker;
}
