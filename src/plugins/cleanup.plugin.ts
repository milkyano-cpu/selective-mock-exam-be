import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

const INTERVAL_MS = 60 * 60 * 1000; // every hour

async function cleanupPlugin(fastify: FastifyInstance) {
  async function purgeExpiredTokens() {
    const now = new Date();
    const [deletedRefresh, deletedResets] = await Promise.all([
      fastify.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      fastify.prisma.passwordResetToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
      }),
    ]);
    if (deletedRefresh.count > 0) {
      fastify.log.info({ count: deletedRefresh.count }, "Purged expired refresh tokens");
    }
    if (deletedResets.count > 0) {
      fastify.log.info({ count: deletedResets.count }, "Purged expired/used password reset tokens");
    }
  }

  const timer = setInterval(() => {
    purgeExpiredTokens().catch((error: unknown) => {
      fastify.log.error(error, "Failed to purge expired refresh tokens");
    });
  }, INTERVAL_MS);

  fastify.addHook("onClose", () => {
    clearInterval(timer);
  });
}

export default fp(cleanupPlugin, {
  name: "cleanup",
  dependencies: ["prisma"],
});
