import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import type { ObjectStorage } from "../../lib/object-storage.js";
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
      questions: true,
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

function serializeImage(image: ImageRecord) {
  const { _count, ...rest } = image;
  return {
    ...rest,
    passageCount: _count.passages,
    questionCount: _count.questions,
  };
}

const IMAGE_TYPE_FOLDER: Record<string, string> = {
  QUESTION: "questions",
  PASSAGE: "passages",
};

function generateRefId() {
  return crypto.randomUUID();
}

function extractBaseName(filePath: string) {
  return filePath.split("/").filter(Boolean).pop() ?? filePath;
}

function oneMonthFrom(date = new Date()) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
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

const KNOWN_IMAGE_BUCKETS = () => [
  env.S3_IMAGE_BUCKET,
  env.S3_QUESTION_IMAGE_BUCKET,
  env.S3_PASSAGE_BUCKET,
];

function parseBucketAndKey(url: string | null): { bucket: string; key: string } | null {
  if (!url) return null;

  const buckets = KNOWN_IMAGE_BUCKETS();

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    for (const bucket of buckets) {
      const idx = parts.findIndex((part) => part === bucket);
      if (idx >= 0) {
        return { bucket, key: parts.slice(idx + 1).map(decodeURIComponent).join("/") };
      }
    }
  } catch {
    const normalized = url.replace(/^\/+/, "");
    for (const bucket of buckets) {
      const prefix = `${bucket}/`;
      if (normalized.startsWith(prefix)) {
        return { bucket, key: normalized.slice(prefix.length) };
      }
    }
  }

  return null;
}

async function deleteImageObjectByUrl(storage: ObjectStorage, url: string | null) {
  const parsed = parseBucketAndKey(url);
  if (!parsed) return;
  await storage.deleteObject(parsed.bucket, parsed.key);
}

async function getImageUsageCounts(prisma: PrismaClient, fileName: string) {
  const [passageCount, questionCount] = await Promise.all([
    prisma.passage.count({ where: { imageRef: fileName } }),
    prisma.question.count({ where: { imageRef: fileName } }),
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
      expiredDate: isLinked ? null : image.url ? oneMonthFrom() : null,
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
        expiredDate: input.linked ? null : oneMonthFrom(),
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
    data: items.map(serializeImage),
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

  return serializeImage(updated);
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
      expiredDate: oneMonthFrom(),
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

  return serializeImage(updated);
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
      expiredDate: passageCount + questionCount > 0 ? null : oneMonthFrom(),
    },
    select: IMAGE_SELECT,
  });

  if (oldUrl && oldUrl !== url) {
    await deleteImageObjectByUrl(storage, oldUrl).catch(() => undefined);
  }

  return serializeImage(updated);
}

export async function deleteImage(prisma: PrismaClient, storage: ObjectStorage, uuid: string) {
  const image = await prisma.image.findUnique({
    where: { uuid },
    select: IMAGE_SELECT,
  });
  if (!image) throw createHttpError(404, "Image not found");

  if (image._count.passages + image._count.questions > 0) {
    throw createHttpError(409, "Cannot delete image while it is linked to passages or questions");
  }

  await deleteImageObjectByUrl(storage, image.url);
  await prisma.image.delete({ where: { uuid } });
}

export async function purgeExpiredImages(prisma: PrismaClient, storage: ObjectStorage, now = new Date()) {
  const expiredImages = await prisma.image.findMany({
    where: {
      expiredDate: { lte: now },
      passages: { none: {} },
      questions: { none: {} },
    },
    select: {
      uuid: true,
      url: true,
    },
  });

  let deleted = 0;
  for (const image of expiredImages) {
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
