import type { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { createHttpError } from "../../utils/http-error.js";
import { STORAGE_PREFIXES, type ObjectStorage } from "../../lib/object-storage.js";
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

function extractBannerObjectKey(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  const prefix = STORAGE_PREFIXES.BANNER_IMAGE;

  const findKey = (parts: string[]) => {
    const prefixIdx = parts.findIndex((part) => part === prefix);
    if (prefixIdx >= 0) {
      return parts.slice(prefixIdx).map(decodeURIComponent).join("/");
    }
    return null;
  };

  try {
    const parsed = new URL(imageUrl);
    return findKey(parsed.pathname.split("/").filter(Boolean));
  } catch {
    return findKey(imageUrl.replace(/^\/+/, "").split("/").filter(Boolean));
  }
}

type WarnLogger = { warn: (obj: unknown, msg?: string) => void } | undefined;

async function deleteBannerImageFromStorage(
  storage: ObjectStorage,
  imageUrl: string | null,
  context: { bannerId: string; logger: WarnLogger }
) {
  const key = extractBannerObjectKey(imageUrl);
  if (!key) return;
  try {
    await storage.deleteObject(key);
  } catch (error) {
    context.logger?.warn(
      { bannerId: context.bannerId, key, error },
      "Failed to delete banner image from object storage; orphaned object will remain"
    );
  }
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

export async function updateBannerRecord(
  prisma: PrismaClient,
  id: string,
  input: UpdateBannerInput,
  storage?: ObjectStorage,
  logger?: { warn: (obj: unknown, msg?: string) => void }
) {
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

  // If the image URL was replaced with a different value, clean up the previous file.
  if (
    storage
    && input.imageUrl !== undefined
    && banner.imageUrl
    && banner.imageUrl !== input.imageUrl
  ) {
    await deleteBannerImageFromStorage(storage, banner.imageUrl, { bannerId: id, logger });
  }

  return withPublicBannerImageUrl(updatedBanner);
}

export async function deleteBannerRecord(
  prisma: PrismaClient,
  storage: ObjectStorage,
  id: string,
  logger?: { warn: (obj: unknown, msg?: string) => void }
) {
  const banner = await prisma.banner.findUnique({ where: { id } });
  if (!banner) {
    throw createHttpError(404, "Banner not found");
  }

  const deleted = await prisma.banner.delete({ where: { id } });
  await deleteBannerImageFromStorage(storage, banner.imageUrl, { bannerId: id, logger });
  return deleted;
}
