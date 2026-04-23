import type { PrismaClient } from "@prisma/client";

export async function checkDbConnection(prisma: PrismaClient): Promise<string> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "disconnected";
  }
}
