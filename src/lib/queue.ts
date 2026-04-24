import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export type QueueName = "grading" | "analytics" | "ai-feedback" | "leaderboard";

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName, redis: Redis): Queue {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: redis }));
  }
  return queues.get(name)!;
}
