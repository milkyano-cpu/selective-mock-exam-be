import type { FastifyRequest, FastifyReply } from "fastify";
import type { CreateResourceInput, UpdateResourceInput, ListResourcesQuery } from "./resources.schema.js";
import {
  findAllResources,
  findResourceById,
  getResourcePreviewFile,
  createResourceRecord,
  updateResourceRecord,
  deleteResourceRecord,
  assertResourceCanReceiveUpload,
} from "./resources.service.js";
import { createHttpError } from "../../utils/http-error.js";

function sanitizeFilename(filename: string) {
  return filename.replace(/["\\\r\n]/g, "_");
}

function resolvePreviewContentType(fileName: string, mimeType: string) {
  const lowerFileName = fileName.toLowerCase();
  if (lowerFileName.endsWith(".pdf")) return "application/pdf";
  if (lowerFileName.endsWith(".mp4")) return "video/mp4";
  if (lowerFileName.endsWith(".webm")) return "video/webm";
  if (lowerFileName.endsWith(".ogg")) return "video/ogg";
  return mimeType;
}

export async function listResourcesHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListResourcesQuery;
  const result = await findAllResources(request.server.prisma, query);
  return reply.send({
    success: true,
    message: "Resources retrieved successfully",
    ...result,
  });
}

export async function getResourceHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const resource = await findResourceById(request.server.prisma, id);
  return reply.send({
    success: true,
    message: "Resource retrieved successfully",
    data: resource,
  });
}

export async function previewResourceFileHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const file = await getResourcePreviewFile(request.server.prisma, request.server.storage, id);
  const fileName = sanitizeFilename(file.fileName);
  const contentType = resolvePreviewContentType(fileName, file.mimeType);

  reply.header("Content-Type", contentType);
  reply.header("Content-Disposition", `inline; filename="${fileName}"`);
  reply.header("Cache-Control", "private, max-age=300");
  if (file.size) reply.header("Content-Length", String(file.size));

  return reply.send(file.body);
}

export async function createResourceHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateResourceInput;
  const resource = await createResourceRecord(request.server.prisma, body, request.user.sub);
  return reply.status(201).send({
    success: true,
    message: "Resource created successfully",
    data: resource,
  });
}

export async function updateResourceHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as UpdateResourceInput;
  const resource = await updateResourceRecord(request.server.prisma, id, body);
  return reply.send({
    success: true,
    message: "Resource updated successfully",
    data: resource,
  });
}

export async function deleteResourceHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await deleteResourceRecord(request.server.prisma, id);
  return reply.send({
    success: true,
    message: "Resource deleted successfully",
  });
}

export async function uploadResourceFileHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  const data = await request.file();
  if (!data) throw createHttpError(400, "No file uploaded");
  await assertResourceCanReceiveUpload(request.server.prisma, id, data.mimetype);

  const buffer = await data.toBuffer();
  const safeFilename = `${Date.now()}-${data.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const fileUrl = await request.server.storage.uploadResourceFile({
    resourceId: id,
    filename: safeFilename,
    body: buffer,
    contentType: data.mimetype,
    contentLength: buffer.length,
  });

  const resource = await updateResourceRecord(request.server.prisma, id, {
    fileUrl,
    fileName: data.filename,
    fileSize: buffer.length,
    mimeType: data.mimetype,
  });

  request.log.info({ resourceId: id, uploadedBy: request.user.sub, fileUrl }, "Resource file uploaded");

  return reply.send({
    success: true,
    message: "File uploaded successfully",
    data: resource,
  });
}
