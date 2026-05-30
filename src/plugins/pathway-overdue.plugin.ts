import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { notifyOverduePlans } from "../modules/pathway-plans/pathway-plans.service.js";

const DAILY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Run the overdue sweep shortly after a server start so a fresh deploy doesn't
// wait a full day, then once daily at ~2 AM (offset from the 1 AM cleanup job).
const INITIAL_DELAY_MS = 60 * 1000; // 1 minute after boot

function msUntilNext2AM(): number {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

async function pathwayOverduePlugin(fastify: FastifyInstance) {
  let dailyTimer: ReturnType<typeof setInterval> | undefined;
  let dailyStartTimer: ReturnType<typeof setTimeout> | undefined;
  let initialTimer: ReturnType<typeof setTimeout> | undefined;

  const sweep = () => {
    notifyOverduePlans(fastify.prisma)
      .then((sent) => {
        if (sent > 0) {
          fastify.log.info({ count: sent }, "Sent pathway plan overdue notifications");
        }
      })
      .catch((error: unknown) => {
        fastify.log.error(error, "Failed to send pathway plan overdue notifications");
      });
  };

  // First sweep soon after boot.
  initialTimer = setTimeout(sweep, INITIAL_DELAY_MS);

  // Align the recurring sweep to ~2 AM, then repeat every 24h.
  dailyStartTimer = setTimeout(() => {
    sweep();
    dailyTimer = setInterval(sweep, DAILY_MS);
  }, msUntilNext2AM());

  fastify.addHook("onClose", () => {
    clearTimeout(initialTimer);
    clearTimeout(dailyStartTimer);
    clearInterval(dailyTimer);
  });

  fastify.log.info("Pathway overdue scheduler registered");
}

export default fp(pathwayOverduePlugin, {
  name: "pathway-overdue",
  dependencies: ["prisma"],
});
