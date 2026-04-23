import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const INTERVAL_MS = 60 * 60 * 1000; // every hour

async function cleanupPlugin(fastify: FastifyInstance) {
  async function purgeExpiredTokens() {
    const deleted = await fastify.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (deleted.count > 0) {
      fastify.log.info({ count: deleted.count }, "Purged expired refresh tokens");
    }
  }

  const timer = setInterval(purgeExpiredTokens, INTERVAL_MS);

  fastify.addHook("onClose", () => {
    clearInterval(timer);
  });
}

export default fp(cleanupPlugin, {
  name: "cleanup",
  dependencies: ["prisma"],
});
