import type { Prisma, PrismaClient } from "@prisma/client";
import { STORAGE_PREFIXES, type ObjectStorage } from "../../lib/object-storage.js";
import { createHttpError } from "../../utils/http-error.js";
import type { ListImagesQuery, UpdateImageBody } from "./images.schema.js";

const IMAGE_SELECT = {
  uuid: true,
  fileName: true,
  imageType: true,
  refId: true,
  altText: true,
  caption: true,
  url: true,
  expiredDate: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      passages: true,
    },
  },
} as const;

export const IMAGE_SUMMARY_SELECT = {
  fileName: true,
  url: true,
  altText: true,
  caption: true,
} as const;

type ImageRecord = Prisma.ImageGetPayload<{ select: typeof IMAGE_SELECT }>;
export type ImageSummaryRecord = Prisma.ImageGetPayload<{ select: typeof IMAGE_SUMMARY_SELECT }>;

export function serializeImageSummary(image: ImageSummaryRecord | null) {
  if (!image) return null;
  return {
    fileName: image.fileName,
    url: image.url,
    altText: image.altText,
    caption: image.caption,
  };
}

async function serializeImage(prisma: PrismaClient, image: ImageRecord) {
  const { _count, ...rest } = image;
  const questionCount = await prisma.question.count({ where: { imageRefs: { has: image.fileName } } });
  return {
    ...rest,
    passageCount: _count.passages,
    questionCount,
  };
}

const IMAGE_TYPE_FOLDER: Record<string, string> = {
  QUESTION: STORAGE_PREFIXES.QUESTION_IMAGE,
  PASSAGE: STORAGE_PREFIXES.PASSAGE,
};

function generateRefId() {
  return crypto.randomUUID();
}

function extractBaseName(filePath: string) {
  return filePath.split("/").filter(Boolean).pop() ?? filePath;
}

function oneWeekFrom(date = new Date()) {
  const next = new Date(date);
  next.setDate(next.getDate() + 7);
  return next;
}

function isBlank(value: string | null | undefined) {
  return !value || value.trim() === "";
}

export function normalizeImageFileName(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const withoutQuery = trimmed.split(/[?#]/)[0] ?? "";
  const normalizedPath = withoutQuery.replace(/\\/g, "/");
  return normalizedPath.replace(/^\/+|\/+$/g, "").trim();
}

function storageSafeFileName(fileName: string) {
  return fileName.replace(/[^A-Za-z0-9._-]/g, "_");
}

const IMAGE_KEY_PREFIXES: readonly string[] = [
  STORAGE_PREFIXES.IMAGE,
  STORAGE_PREFIXES.QUESTION_IMAGE,
  STORAGE_PREFIXES.PASSAGE,
];

function extractObjectKeyFromUrl(url: string | null, bucket: string): string | null {
  if (!url) return null;

  const findKeyStart = (parts: string[]) => {
    const bucketIdx = parts.findIndex((part) => part === bucket);
    if (bucketIdx >= 0) {
      const remainder = parts.slice(bucketIdx + 1);
      if (remainder.length > 0 && IMAGE_KEY_PREFIXES.includes(remainder[0]!)) {
        return remainder.map(decodeURIComponent).join("/");
      }
    }
    const prefixIdx = parts.findIndex((part) => IMAGE_KEY_PREFIXES.includes(part));
    if (prefixIdx >= 0) {
      return parts.slice(prefixIdx).map(decodeURIComponent).join("/");
    }
    return null;
  };

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return findKeyStart(parts);
  } catch {
    const normalized = url.replace(/^\/+/, "");
    const parts = normalized.split("/").filter(Boolean);
    return findKeyStart(parts);
  }
}

async function deleteImageObjectByUrl(storage: ObjectStorage, url: string | null) {
  const key = extractObjectKeyFromUrl(url, storage.bucket);
  if (!key) return;
  await storage.deleteObject(key);
}

async function getImageUsageCounts(prisma: PrismaClient, fileName: string) {
  const [passageCount, questionCount] = await Promise.all([
    prisma.passage.count({ where: { imageRef: fileName } }),
    prisma.question.count({ where: { imageRefs: { has: fileName } } }),
  ]);
  return { passageCount, questionCount };
}

export async function refreshImageExpiration(prisma: PrismaClient, rawFileName?: string | null) {
  const fileName = normalizeImageFileName(rawFileName);
  if (!fileName) return;

  const image = await prisma.image.findUnique({
    where: { fileName },
    select: { uuid: true, url: true },
  });
  if (!image) return;

  const { passageCount, questionCount } = await getImageUsageCounts(prisma, fileName);
  const isLinked = passageCount + questionCount > 0;

  await prisma.image.update({
    where: { uuid: image.uuid },
    data: {
      expiredDate: isLinked ? null : image.url ? oneWeekFrom() : null,
    },
  });
}

export async function refreshImageExpirations(prisma: PrismaClient, refs: Array<string | null | undefined>) {
  const uniqueRefs = [...new Set(refs.map(normalizeImageFileName).filter(Boolean))];
  await Promise.all(uniqueRefs.map((fileName) => refreshImageExpiration(prisma, fileName)));
}

export async function markImagesLinked(prisma: PrismaClient, refs: Array<string | null | undefined>) {
  const uniqueRefs = [...new Set(refs.map(normalizeImageFileName).filter(Boolean))];
  if (uniqueRefs.length === 0) return;

  await prisma.image.updateMany({
    where: { fileName: { in: uniqueRefs } },
    data: { expiredDate: null },
  });
}

export async function findMissingImageRefs(prisma: PrismaClient, refs: Array<string | null | undefined>) {
  const uniqueRefs = [...new Set(refs.map(normalizeImageFileName).filter(Boolean))];
  if (uniqueRefs.length === 0) return [];

  const found = await prisma.image.findMany({
    where: { fileName: { in: uniqueRefs } },
    select: { fileName: true },
  });
  const foundSet = new Set(found.map((image) => image.fileName));
  return uniqueRefs.filter((fileName) => !foundSet.has(fileName));
}

export async function loadImageSummariesByFileNames(prisma: PrismaClient, refs: Array<string | null | undefined>) {
  const uniqueRefs = [...new Set(refs.map(normalizeImageFileName).filter(Boolean))];
  if (uniqueRefs.length === 0) return new Map<string, ImageSummaryRecord>();
  const images = await prisma.image.findMany({
    where: { fileName: { in: uniqueRefs } },
    select: IMAGE_SUMMARY_SELECT,
  });
  return new Map(images.map((image) => [image.fileName, image]));
}

const ALLOWED_AI_IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function inferMediaTypeFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    default: return "image/jpeg";
  }
}

/**
 * Resolve image file names to base64-encoded payloads suitable for Anthropic
 * vision content blocks. Preserves the input order; skips any image that
 * cannot be fetched or has an unsupported media type.
 */
export async function resolveImagesAsBase64(
  prisma: PrismaClient,
  fileNames: Array<string | null | undefined>,
): Promise<Array<{ fileName: string; data: string; mediaType: string }>> {
  const uniqueRefs = [...new Set(fileNames.map(normalizeImageFileName).filter(Boolean))];
  if (uniqueRefs.length === 0) return [];

  const images = await prisma.image.findMany({
    where: { fileName: { in: uniqueRefs } },
    select: { fileName: true, url: true },
  });
  const urlByFileName = new Map(images.map((image) => [image.fileName, image.url]));

  const results = await Promise.all(
    uniqueRefs.map(async (fileName) => {
      const url = urlByFileName.get(fileName);
      if (!url) return null;
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        const headerType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        const mediaType = headerType && ALLOWED_AI_IMAGE_MEDIA_TYPES.has(headerType)
          ? headerType
          : inferMediaTypeFromFileName(fileName);
        if (!ALLOWED_AI_IMAGE_MEDIA_TYPES.has(mediaType)) return null;
        return { fileName, data: buffer.toString("base64"), mediaType };
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is { fileName: string; data: string; mediaType: string } => r !== null);
}

export async function upsertImageMetadata(
  prisma: PrismaClient,
  input: { fileName: string; altText?: string | null; caption?: string | null; linked?: boolean }
) {
  const fileName = normalizeImageFileName(input.fileName);
  if (!fileName) return null;

  const altText = input.altText?.trim() || null;
  const caption = input.caption?.trim() || null;
  const existing = await prisma.image.findUnique({
    where: { fileName },
    select: { uuid: true, altText: true, caption: true },
  });

  if (!existing) {
    await prisma.image.create({
      data: {
        fileName,
        altText,
        caption,
        expiredDate: input.linked ? null : oneWeekFrom(),
      },
    });
    return fileName;
  }

  const data: Prisma.ImageUpdateInput = {};
  if (input.linked) data.expiredDate = null;
  if (altText && isBlank(existing.altText)) data.altText = altText;
  if (caption && isBlank(existing.caption)) data.caption = caption;

  if (Object.keys(data).length > 0) {
    await prisma.image.update({ where: { uuid: existing.uuid }, data });
  }

  return fileName;
}

export async function listImages(prisma: PrismaClient, query: ListImagesQuery) {
  const { page, limit, search } = query;
  const skip = (page - 1) * limit;
  const where: Prisma.ImageWhereInput = {};

  if (search?.trim()) {
    const q = search.trim();
    where.OR = [
      { fileName: { contains: q, mode: "insensitive" } },
      { altText: { contains: q, mode: "insensitive" } },
      { caption: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.image.findMany({
      where,
      select: IMAGE_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.image.count({ where }),
  ]);

  return {
    data: await Promise.all(items.map((image) => serializeImage(prisma, image))),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateImageMetadata(prisma: PrismaClient, uuid: string, body: UpdateImageBody) {
  const existing = await prisma.image.findUnique({
    where: { uuid },
    select: { uuid: true },
  });
  if (!existing) throw createHttpError(404, "Image not found");

  const updated = await prisma.image.update({
    where: { uuid },
    data: {
      ...(body.altText !== undefined && { altText: body.altText?.trim() || null }),
      ...(body.caption !== undefined && { caption: body.caption?.trim() || null }),
    },
    select: IMAGE_SELECT,
  });

  return serializeImage(prisma, updated);
}

export async function uploadImage(
  prisma: PrismaClient,
  storage: ObjectStorage,
  input: {
    imageType: "QUESTION" | "PASSAGE";
    originalFileName: string;
    altText?: string | null;
    caption?: string | null;
    body: Buffer;
    contentType: string;
    contentLength: number;
  }
) {
  const baseName = extractBaseName(input.originalFileName);
  if (!baseName) throw createHttpError(400, "File name is required");

  const refId = generateRefId();
  const folder = IMAGE_TYPE_FOLDER[input.imageType];
  const fileName = `${folder}/${refId}/${baseName}`;
  const s3Key = `${refId}/${storageSafeFileName(baseName)}`;

  const image = await prisma.image.create({
    data: {
      fileName,
      imageType: input.imageType,
      refId,
      altText: input.altText?.trim() || null,
      caption: input.caption?.trim() || null,
      expiredDate: oneWeekFrom(),
    },
    select: IMAGE_SELECT,
  });

  const url = await storage.uploadImage({
    imageType: input.imageType,
    key: s3Key,
    body: input.body,
    contentType: input.contentType,
    contentLength: input.contentLength,
  });

  const updated = await prisma.image.update({
    where: { uuid: image.uuid },
    data: { url },
    select: IMAGE_SELECT,
  });

  return serializeImage(prisma, updated);
}

export async function uploadImageFileByUuid(
  prisma: PrismaClient,
  storage: ObjectStorage,
  uuid: string,
  input: {
    filename: string;
    body: Buffer;
    contentType: string;
    contentLength: number;
  }
) {
  const image = await prisma.image.findUnique({ where: { uuid }, select: IMAGE_SELECT });
  if (!image) throw createHttpError(404, "Image not found");

  const uploadedBaseName = extractBaseName(input.filename);
  const storedBaseName = extractBaseName(image.fileName);
  if (uploadedBaseName !== storedBaseName) {
    throw createHttpError(400, `Uploaded file name must match "${storedBaseName}"`);
  }

  const parts = image.fileName.split("/");
  const s3Key = parts.slice(1).map((seg, i, arr) =>
    i === arr.length - 1 ? storageSafeFileName(seg) : seg
  ).join("/");

  const url = await storage.uploadImage({
    imageType: image.imageType,
    key: s3Key,
    body: input.body,
    contentType: input.contentType,
    contentLength: input.contentLength,
  });

  const { passageCount, questionCount } = await getImageUsageCounts(prisma, image.fileName);
  const oldUrl = image.url;
  const updated = await prisma.image.update({
    where: { uuid: image.uuid },
    data: {
      url,
      expiredDate: passageCount + questionCount > 0 ? null : oneWeekFrom(),
    },
    select: IMAGE_SELECT,
  });

  if (oldUrl && oldUrl !== url) {
    await deleteImageObjectByUrl(storage, oldUrl).catch(() => undefined);
  }

  return serializeImage(prisma, updated);
}

export async function deleteImage(prisma: PrismaClient, storage: ObjectStorage, uuid: string) {
  const image = await prisma.image.findUnique({
    where: { uuid },
    select: IMAGE_SELECT,
  });
  if (!image) throw createHttpError(404, "Image not found");

  const questionCount = await prisma.question.count({ where: { imageRefs: { has: image.fileName } } });
  if (image._count.passages + questionCount > 0) {
    throw createHttpError(409, "Cannot delete image while it is linked to passages or questions");
  }

  await deleteImageObjectByUrl(storage, image.url);
  await prisma.image.delete({ where: { uuid } });
}

export async function purgeExpiredImages(prisma: PrismaClient, storage: ObjectStorage, now = new Date()) {
  // Candidates: expired images that are not linked to any passage.
  // Questions reference images via an array column (imageRefs), so we have to
  // filter that side manually.
  const candidates = await prisma.image.findMany({
    where: {
      expiredDate: { lte: now },
      passages: { none: {} },
    },
    select: {
      uuid: true,
      url: true,
      fileName: true,
    },
  });

  if (candidates.length === 0) return 0;

  // Find which candidate file_names are still referenced by any question.
  const stillUsedByQuestion = await prisma.question.findMany({
    where: {
      imageRefs: { hasSome: candidates.map((c) => c.fileName) },
    },
    select: { imageRefs: true },
  });
  const usedFileNames = new Set<string>();
  for (const q of stillUsedByQuestion) {
    for (const ref of q.imageRefs) usedFileNames.add(ref);
  }

  const trulyExpired = candidates.filter((c) => !usedFileNames.has(c.fileName));

  let deleted = 0;
  for (const image of trulyExpired) {
    try {
      await deleteImageObjectByUrl(storage, image.url);
      await prisma.image.delete({ where: { uuid: image.uuid } });
      deleted++;
    } catch {
      // Keep the row so the next scheduled cleanup can retry.
    }
  }

  return deleted;
}
