import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { installDnsFallback } from "../config/dns.js";

// pg-connection-string treats 'require'/'prefer'/'verify-ca' as 'verify-full' today,
// but will change semantics in pg v9. Be explicit now to silence the warning.
function normalizeConnectionString(url: string): string {
  return url.replace(/sslmode=(prefer|require|verify-ca)/, "sslmode=verify-full");
}

async function prismaPlugin(fastify: FastifyInstance) {
  const dnsServers = installDnsFallback();
  if (dnsServers.length > 0) {
    fastify.log.info({ dnsServers }, "Installed Node DNS fallback");
  }

  const adapter = new PrismaPg({ connectionString: normalizeConnectionString(env.DATABASE_URL) });

  const prisma = new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  await prisma.$connect();
  fastify.log.info("Prisma connected to PostgreSQL");

  fastify.decorate("prisma", prisma);

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
    fastify.log.info("Prisma disconnected");
  });
}

export default fp(prismaPlugin, {
  name: "prisma",
});
