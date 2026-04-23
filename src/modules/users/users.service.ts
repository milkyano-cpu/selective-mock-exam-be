import type { PrismaClient } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";

export async function getMyProfile(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      subscriptions: {
        select: {
          status: true,
          currentPeriodEnd: true,
        },
        orderBy: { currentPeriodEnd: "desc" },
        take: 1,
      },
    },
  });

  if (!user) {
    throw createHttpError(404, "User not found");
  }

  return user;
}

export async function getUserById(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw createHttpError(404, "User not found");
  }

  return user;
}
