import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createProfilePhotoCleanupWorker } from "../modules/users/profile-photo-cleanup.js";

async function profilePhotoCleanupPlugin(fastify: FastifyInstance) {
  const worker = createProfilePhotoCleanupWorker(
    fastify.redis,
    fastify.storage,
    fastify.log
  );

  fastify.addHook("onClose", async () => {
    await worker.close();
  });
}

export default fp(profilePhotoCleanupPlugin, {
  name: "profilePhotoCleanup",
  dependencies: ["redis", "storage"],
});
