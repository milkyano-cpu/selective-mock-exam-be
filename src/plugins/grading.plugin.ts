import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createGradingWorker } from "../modules/exams/exams.grading.worker.js";

export default fp(
  async (fastify: FastifyInstance) => {
    const worker = createGradingWorker(fastify.redis, fastify.prisma, fastify.log);

    fastify.addHook("onClose", async () => {
      await worker.close();
    });

    fastify.log.info("Grading worker registered");
  },
  {
    name: "grading-worker",
    dependencies: ["redis", "prisma"],
  }
);
