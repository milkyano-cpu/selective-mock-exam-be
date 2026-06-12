import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient, Role, Tier } from "@prisma/client";
import type { CreateResourceInput, UpdateResourceInput, ListResourcesQuery } from "./resources.schema.js";
import {
  findAllResources,
  findResourceById,
  getResourcePreviewFile,
  getResourceStreamUrl,
  createResourceRecord,
  updateResourceRecord,
  deleteResourceRecord,
  assertResourceCanReceiveUpload,
} from "./resources.service.js";
import { createHttpError } from "../../utils/http-error.js";
import { isFaststartCandidate, remuxMp4ToFaststart } from "../../lib/video.js";

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

async function getResourceAccessUser(prisma: PrismaClient, requestUser: FastifyRequest["user"]): Promise<{ role: Role; tier: Tier }> {
  const role = requestUser.role as Role;
  if (role !== "STUDENT") {
    return { role, tier: "BASIC" };
  }

  const user = await prisma.user.findUnique({
    where: { id: requestUser.sub },
    select: { tier: true },
  });

  return { role, tier: user?.tier ?? "BASIC" };
}

export async function listResourcesHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListResourcesQuery;
  const accessUser = await getResourceAccessUser(request.server.prisma, request.user);
  const result = await findAllResources(request.server.prisma, query, accessUser);
  return reply.send({
    success: true,
    message: "Resources retrieved successfully",
    ...result,
  });
}

export async function getResourceHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const accessUser = await getResourceAccessUser(request.server.prisma, request.user);
  const resource = await findResourceById(request.server.prisma, id, accessUser);
  return reply.send({
    success: true,
    message: "Resource retrieved successfully",
    data: resource,
  });
}

export async function previewResourceFileHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { raw } = request.query as { raw?: string };
  const isRaw = raw === "1" || raw === "true";

  const accessUser = await getResourceAccessUser(request.server.prisma, request.user);
  const file = await getResourcePreviewFile(request.server.prisma, request.server.storage, id, accessUser);
  const fileName = sanitizeFilename(file.fileName);
  const resolvedContentType = resolvePreviewContentType(fileName, file.mimeType);

  // Raw mode (in-app viewer): strip the headers that make download managers like
  // IDM intercept the request. We drop Content-Disposition (IDM reads its filename
  // to grab the file) and serve PDFs as text/plain so IDM doesn't see a downloadable
  // file — pdf.js reads the raw bytes and ignores the declared content type.
  const contentType = isRaw && resolvedContentType === "application/pdf" ? "text/plain" : resolvedContentType;

  reply.header("Content-Type", contentType);
  if (!isRaw) reply.header("Content-Disposition", `inline; filename="${fileName}"`);
  reply.header("Cache-Control", "private, max-age=300");
  if (file.size) reply.header("Content-Length", String(file.size));

  return reply.send(file.body);
}

export async function getResourceStreamUrlHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const accessUser = await getResourceAccessUser(request.server.prisma, request.user);
  const result = await getResourceStreamUrl(request.server.prisma, request.server.storage, id, accessUser);
  return reply.send({
    success: true,
    message: "Stream URL generated",
    data: result,
  });
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
  await deleteResourceRecord(request.server.prisma, request.server.storage, id, request.log);
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

  const originalBuffer = await data.toBuffer();

  // Move the MP4/MOV moov atom to the front so the browser can start streaming
  // immediately instead of issuing many scattered range requests to find it.
  const buffer = isFaststartCandidate(data.mimetype, data.filename)
    ? await remuxMp4ToFaststart(originalBuffer, request.log)
    : originalBuffer;

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
