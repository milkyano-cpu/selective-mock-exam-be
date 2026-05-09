import type { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { createHttpError } from "../../utils/http-error.js";
import type { CreateBannerInput, UpdateBannerInput, ListBannersQuery } from "./banners.schema.js";

const BANNER_SELECT = {
  id: true,
  imageUrl: true,
  targetUrl: true,
  isActive: true,
  createdAt: true,
};

function toPublicBannerImageUrl(imageUrl: string) {
  if (!env.S3_PUBLIC_ENDPOINT || env.S3_PUBLIC_ENDPOINT === env.S3_ENDPOINT) {
    return imageUrl;
  }

  try {
    const currentUrl = new URL(imageUrl);
    const storageEndpoint = new URL(env.S3_ENDPOINT);
    const publicEndpoint = env.S3_PUBLIC_ENDPOINT.replace(/\/$/, "");

    if (currentUrl.origin !== storageEndpoint.origin) {
      return imageUrl;
    }

    return `${publicEndpoint}${currentUrl.pathname}${currentUrl.search}`;
  } catch {
    return imageUrl;
  }
}

function withPublicBannerImageUrl<T extends { imageUrl: string }>(banner: T): T {
  return {
    ...banner,
    imageUrl: toPublicBannerImageUrl(banner.imageUrl),
  };
}

export async function findActiveBanners(prisma: PrismaClient) {
  const banners = await prisma.banner.findMany({
    where: { isActive: true, imageUrl: { not: "" } },
    select: BANNER_SELECT,
    orderBy: { createdAt: "asc" },
  });

  return banners.map(withPublicBannerImageUrl);
}

export async function findAllBanners(prisma: PrismaClient, query: ListBannersQuery) {
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.banner.findMany({
      select: BANNER_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.banner.count(),
  ]);

  return {
    data: items.map(withPublicBannerImageUrl),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function createBannerRecord(prisma: PrismaClient, input: CreateBannerInput) {
  const banner = await prisma.banner.create({
    data: {
      imageUrl: input.imageUrl ?? "",
      targetUrl: input.targetUrl || null,
      isActive: input.isActive,
    },
    select: BANNER_SELECT,
  });

  return withPublicBannerImageUrl(banner);
}

export async function updateBannerRecord(prisma: PrismaClient, id: string, input: UpdateBannerInput) {
  const banner = await prisma.banner.findUnique({ where: { id } });
  if (!banner) {
    throw createHttpError(404, "Banner not found");
  }

  const updatedBanner = await prisma.banner.update({
    where: { id },
    data: {
      ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      ...(input.targetUrl !== undefined && { targetUrl: input.targetUrl || null }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
    select: BANNER_SELECT,
  });

  return withPublicBannerImageUrl(updatedBanner);
}

export async function deleteBannerRecord(prisma: PrismaClient, id: string) {
  const banner = await prisma.banner.findUnique({ where: { id } });
  if (!banner) {
    throw createHttpError(404, "Banner not found");
  }

  return prisma.banner.delete({ where: { id } });
}
