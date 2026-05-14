import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { purgeExpiredImages } from "../modules/images/images.service.js";

const DAILY_MS = 24 * 60 * 60 * 1000; // 24 hours

function msUntilNext1AM(): number {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

async function cleanupPlugin(fastify: FastifyInstance) {
  async function purgeExpiredTokens() {
    const now = new Date();
    const [deletedRefresh, deletedResets] = await Promise.all([
      fastify.prisma.refreshToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
      }),
      fastify.prisma.passwordResetToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
      }),
    ]);
    if (deletedRefresh.count > 0) {
      fastify.log.info({ count: deletedRefresh.count }, "Purged expired/revoked refresh tokens");
    }
    if (deletedResets.count > 0) {
      fastify.log.info({ count: deletedResets.count }, "Purged expired/used password reset tokens");
    }
  }

  async function purgeExpiredMasterImages() {
    const deleted = await purgeExpiredImages(fastify.prisma, fastify.storage);
    if (deleted > 0) {
      fastify.log.info({ count: deleted }, "Purged expired master images");
    }
  }

  let dailyTimer: ReturnType<typeof setInterval> | undefined;
  let initialTimer: ReturnType<typeof setTimeout> | undefined;

  initialTimer = setTimeout(() => {
    purgeExpiredTokens().catch((error: unknown) => {
      fastify.log.error(error, "Failed to purge expired refresh tokens");
    });
    purgeExpiredMasterImages().catch((error: unknown) => {
      fastify.log.error(error, "Failed to purge expired master images");
    });
    dailyTimer = setInterval(() => {
      purgeExpiredTokens().catch((error: unknown) => {
        fastify.log.error(error, "Failed to purge expired refresh tokens");
      });
      purgeExpiredMasterImages().catch((error: unknown) => {
        fastify.log.error(error, "Failed to purge expired master images");
      });
    }, DAILY_MS);
  }, msUntilNext1AM());

  fastify.addHook("onClose", () => {
    clearTimeout(initialTimer);
    clearInterval(dailyTimer);
  });
}

export default fp(cleanupPlugin, {
  name: "cleanup",
  dependencies: ["prisma", "storage"],
});
