import type { PrismaClient, ResourceType, Role, Tier } from "@prisma/client";
import { env } from "../../config/env.js";
import type { ObjectStorage } from "../../lib/object-storage.js";
import { createHttpError } from "../../utils/http-error.js";
import type { CreateResourceInput, UpdateResourceInput, ListResourcesQuery } from "./resources.schema.js";

const RESOURCE_SELECT = {
  id: true,
  title: true,
  description: true,
  type: true,
  fileUrl: true,
  videoUrl: true,
  fileName: true,
  fileSize: true,
  mimeType: true,
  allowedTiers: true,
  uploadedBy: true,
  createdAt: true,
  updatedAt: true,
  uploader: {
    select: { fullName: true },
  },
};

const TIER_ORDER: Tier[] = ["BASIC", "STANDARD", "PREMIUM"];

function toPublicFileUrl(fileUrl: string | null) {
  if (!fileUrl) return null;
  if (!env.S3_PUBLIC_ENDPOINT || env.S3_PUBLIC_ENDPOINT === env.S3_ENDPOINT) {
    return fileUrl;
  }

  try {
    const currentUrl = new URL(fileUrl);
    const storageEndpoint = new URL(env.S3_ENDPOINT);
    const publicEndpoint = env.S3_PUBLIC_ENDPOINT.replace(/\/$/, "");

    if (currentUrl.origin !== storageEndpoint.origin) {
      return fileUrl;
    }

    return `${publicEndpoint}${currentUrl.pathname}${currentUrl.search}`;
  } catch {
    return fileUrl;
  }
}

function mapResource(resource: Record<string, unknown>) {
  const r = resource as {
    id: string;
    title: string;
    description: string;
    type: ResourceType;
    fileUrl: string | null;
    videoUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
    mimeType: string | null;
    allowedTiers: Tier[];
    uploadedBy: string;
    createdAt: Date;
    updatedAt: Date;
    uploader?: { fullName: string };
  };

  return {
    id: r.id,
    title: r.title,
    description: r.description,
    type: r.type,
    fileUrl: toPublicFileUrl(r.fileUrl),
    videoUrl: r.videoUrl,
    fileName: r.fileName,
    fileSize: r.fileSize,
    mimeType: r.mimeType,
    allowedTiers: r.allowedTiers,
    uploadedBy: r.uploadedBy,
    uploaderName: r.uploader?.fullName ?? "",
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function getResourceObjectKey(fileUrl: string) {
  try {
    const parsed = new URL(fileUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const bucketIndex = parts.findIndex((part) => part === env.S3_RESOURCE_BUCKET);

    if (bucketIndex >= 0) {
      return parts.slice(bucketIndex + 1).map(decodeURIComponent).join("/");
    }

    return parts.map(decodeURIComponent).join("/");
  } catch {
    const normalized = fileUrl.replace(/^\/+/, "");
    const bucketPrefix = `${env.S3_RESOURCE_BUCKET}/`;
    return normalized.startsWith(bucketPrefix) ? normalized.slice(bucketPrefix.length) : normalized;
  }
}

function applyTierAccessFilter(where: Record<string, unknown>, user: { role: Role; tier: Tier }) {
  if (user.role === "STUDENT") {
    where.allowedTiers = { has: user.tier };
  }
}

function assertResourceTierAccess(allowedTiers: readonly Tier[], user: { role: Role; tier: Tier }) {
  if (user.role === "STUDENT" && !allowedTiers.includes(user.tier)) {
    throw createHttpError(403, "You do not have access to this resource");
  }
}

function normalizeAllowedTiersByMinimumTier(allowedTiers: readonly Tier[] | undefined) {
  if (!allowedTiers || allowedTiers.length === 0) return TIER_ORDER;
  const minimumTierIndex = Math.min(
    ...allowedTiers.map((tier) => TIER_ORDER.indexOf(tier)).filter((index) => index >= 0)
  );
  if (!Number.isFinite(minimumTierIndex)) return TIER_ORDER;
  return TIER_ORDER.slice(minimumTierIndex);
}

export async function findAllResources(prisma: PrismaClient, query: ListResourcesQuery, user: { role: Role; tier: Tier }) {
  const { page, limit, type, search } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  applyTierAccessFilter(where, user);
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.resource.findMany({
      where,
      select: RESOURCE_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.resource.count({ where }),
  ]);

  return {
    data: items.map(mapResource),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function findResourceById(prisma: PrismaClient, id: string, user: { role: Role; tier: Tier }) {
  const resource = await prisma.resource.findUnique({
    where: { id },
    select: RESOURCE_SELECT,
  });

  if (!resource) throw createHttpError(404, "Resource not found");
  assertResourceTierAccess((resource as { allowedTiers: Tier[] }).allowedTiers, user);

  return mapResource(resource);
}

export async function getResourcePreviewFile(prisma: PrismaClient, storage: ObjectStorage, id: string, user: { role: Role; tier: Tier }) {
  const resource = await prisma.resource.findUnique({
    where: { id },
    select: {
      title: true,
      fileUrl: true,
      fileName: true,
      mimeType: true,
      allowedTiers: true,
    },
  });

  if (!resource) throw createHttpError(404, "Resource not found");
  assertResourceTierAccess((resource as { allowedTiers: Tier[] }).allowedTiers, user);
  if (!resource.fileUrl) throw createHttpError(404, "Resource file not found");

  const key = getResourceObjectKey(resource.fileUrl);
  if (!key) throw createHttpError(404, "Resource file object not found");

  const object = await storage.getResourceFileObject(key);

  return {
    ...object,
    fileName: resource.fileName || resource.title || "resource",
    mimeType: resource.mimeType || object.contentType || "application/octet-stream",
  };
}

export async function getResourceStreamUrl(
  prisma: PrismaClient,
  storage: import("../../lib/object-storage.js").ObjectStorage,
  id: string,
  user: { role: Role; tier: Tier }
): Promise<{ url: string; fileName: string; mimeType: string }> {
  const resource = await prisma.resource.findUnique({
    where: { id },
    select: {
      title: true,
      fileUrl: true,
      fileName: true,
      mimeType: true,
      allowedTiers: true,
    },
  });

  if (!resource) throw createHttpError(404, "Resource not found");
  assertResourceTierAccess((resource as { allowedTiers: Tier[] }).allowedTiers, user);
  if (!resource.fileUrl) throw createHttpError(404, "Resource file not found");

  const key = getResourceObjectKey(resource.fileUrl);
  if (!key) throw createHttpError(404, "Resource file object not found");

  const signedUrl = await storage.getResourceFileSignedUrl(key);

  return {
    url: signedUrl,
    fileName: resource.fileName || resource.title || "resource",
    mimeType: resource.mimeType || "application/octet-stream",
  };
}

export async function createResourceRecord(
  prisma: PrismaClient,
  input: CreateResourceInput,
  uploadedBy: string
) {
  const resource = await prisma.resource.create({
    data: {
      title: input.title,
      description: input.description ?? "",
      type: input.type as ResourceType,
      videoUrl: input.type === "VIDEO" ? (input.videoUrl ?? null) : null,
      allowedTiers: normalizeAllowedTiersByMinimumTier(input.allowedTiers),
      uploadedBy,
    },
    select: RESOURCE_SELECT,
  });

  return mapResource(resource);
}

export async function updateResourceRecord(
  prisma: PrismaClient,
  id: string,
  input: UpdateResourceInput & { fileUrl?: string; fileName?: string; fileSize?: number; mimeType?: string }
) {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) throw createHttpError(404, "Resource not found");
  if (input.fileUrl !== undefined && resource.type === "VIDEO" && !input.mimeType?.startsWith("video/")) {
    throw createHttpError(400, "VIDEO resources can only receive video uploads");
  }

  const updated = await prisma.resource.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.allowedTiers !== undefined && { allowedTiers: normalizeAllowedTiersByMinimumTier(input.allowedTiers) }),
      ...(input.fileUrl !== undefined && { fileUrl: input.fileUrl }),
      ...(input.fileName !== undefined && { fileName: input.fileName }),
      ...(input.fileSize !== undefined && { fileSize: input.fileSize }),
      ...(input.mimeType !== undefined && { mimeType: input.mimeType }),
    },
    select: RESOURCE_SELECT,
  });

  return mapResource(updated);
}

export async function assertResourceCanReceiveUpload(prisma: PrismaClient, id: string, mimeType: string) {
  const resource = await prisma.resource.findUnique({
    where: { id },
    select: { id: true, type: true },
  });

  if (!resource) throw createHttpError(404, "Resource not found");
  if (resource.type === "VIDEO" && !mimeType.startsWith("video/")) {
    throw createHttpError(400, "VIDEO resources can only receive video uploads");
  }
}

export async function deleteResourceRecord(prisma: PrismaClient, id: string) {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) throw createHttpError(404, "Resource not found");

  return prisma.resource.delete({ where: { id } });
}
