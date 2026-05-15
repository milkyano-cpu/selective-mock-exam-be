import type { FastifyReply, FastifyRequest } from "fastify";
import { createHttpError } from "../../utils/http-error.js";
import type { ListImagesQuery, UpdateImageBody } from "./images.schema.js";
import {
  deleteImage,
  listImages,
  updateImageMetadata,
  uploadImage,
  uploadImageFileByUuid,
} from "./images.service.js";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

type MultipartFields = Record<string, { value?: unknown } | undefined>;

function getMultipartField(fields: MultipartFields | undefined, name: string) {
  const value = fields?.[name]?.value;
  return typeof value === "string" ? value.trim() : undefined;
}

function assertAllowedImageType(mimetype: string) {
  if (!ALLOWED_IMAGE_TYPES.includes(mimetype)) {
    throw createHttpError(400, "Only JPEG, PNG, WebP, and GIF images are allowed");
  }
}

export async function listImagesHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListImagesQuery;
  const result = await listImages(request.server.prisma, query);

  return reply.send({
    success: true,
    message: "Images retrieved",
    data: result.data,
    meta: result.meta,
  });
}

const VALID_IMAGE_TYPES = new Set(["QUESTION", "PASSAGE"]);

export async function createImageHandler(request: FastifyRequest, reply: FastifyReply) {
  const data = await request.file();
  if (!data) throw createHttpError(400, "No file uploaded");

  assertAllowedImageType(data.mimetype);

  const buffer = await data.toBuffer();
  const fields = (data as { fields?: MultipartFields }).fields;
  const rawImageType = (getMultipartField(fields, "imageType") || getMultipartField(fields, "image_type") || "").toUpperCase();
  if (!VALID_IMAGE_TYPES.has(rawImageType)) {
    throw createHttpError(400, "imageType is required and must be QUESTION or PASSAGE");
  }
  const imageType = rawImageType as "QUESTION" | "PASSAGE";
  const altText = getMultipartField(fields, "altText") || getMultipartField(fields, "alt_text") || null;
  const caption = getMultipartField(fields, "caption") || null;

  const image = await uploadImage(request.server.prisma, request.server.storage, {
    imageType,
    originalFileName: data.filename,
    altText,
    caption,
    body: buffer,
    contentType: data.mimetype,
    contentLength: buffer.length,
  });

  request.log.info({ imageUuid: image.uuid, fileName: image.fileName, uploadedBy: request.user.sub }, "Master image uploaded");

  return reply.code(201).send({
    success: true,
    message: "Image uploaded",
    data: image,
  });
}

export async function updateImageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { uuid } = request.params as { uuid: string };
  const body = request.body as UpdateImageBody;
  const image = await updateImageMetadata(request.server.prisma, uuid, body);

  return reply.send({
    success: true,
    message: "Image updated",
    data: image,
  });
}

export async function uploadImageFileHandler(request: FastifyRequest, reply: FastifyReply) {
  const { uuid } = request.params as { uuid: string };
  const data = await request.file();
  if (!data) throw createHttpError(400, "No file uploaded");

  assertAllowedImageType(data.mimetype);

  const buffer = await data.toBuffer();
  const image = await uploadImageFileByUuid(request.server.prisma, request.server.storage, uuid, {
    filename: data.filename,
    body: buffer,
    contentType: data.mimetype,
    contentLength: buffer.length,
  });

  request.log.info({ imageUuid: uuid, fileName: image.fileName, uploadedBy: request.user.sub }, "Master image file uploaded");

  return reply.send({
    success: true,
    message: "Image file uploaded",
    data: image,
  });
}

export async function deleteImageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { uuid } = request.params as { uuid: string };
  await deleteImage(request.server.prisma, request.server.storage, uuid);

  return reply.send({
    success: true,
    message: "Image deleted",
  });
}
