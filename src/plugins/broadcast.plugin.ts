import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createBroadcastWorker } from "../modules/announcements/announcements.worker.js";

export default fp(
  async (fastify: FastifyInstance) => {
    const worker = createBroadcastWorker(
      fastify.redis,
      fastify.prisma,
      fastify.log
    );

    fastify.addHook("onClose", async () => {
      await worker.close();
    });

    fastify.log.info("Broadcast worker registered");
  },
  {
    name: "broadcast-worker",
    dependencies: ["redis", "prisma"],
  }
);
