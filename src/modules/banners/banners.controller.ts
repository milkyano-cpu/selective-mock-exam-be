import type { FastifyRequest, FastifyReply } from "fastify";
import type { CreateBannerInput, UpdateBannerInput, ListBannersQuery } from "./banners.schema.js";
import { findActiveBanners, findAllBanners, createBannerRecord, updateBannerRecord, deleteBannerRecord } from "./banners.service.js";
import { createHttpError } from "../../utils/http-error.js";

export async function getActiveBannersHandler(request: FastifyRequest, reply: FastifyReply) {
  const banners = await findActiveBanners(request.server.prisma);
  return reply.send({
    success: true,
    message: "Active banners retrieved successfully",
    data: banners,
  });
}

export async function listBannersHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListBannersQuery;
  const result = await findAllBanners(request.server.prisma, query);
  return reply.send({
    success: true,
    message: "Banners retrieved successfully",
    ...result,
  });
}

export async function createBannerHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateBannerInput;
  const banner = await createBannerRecord(request.server.prisma, body);
  return reply.status(201).send({
    success: true,
    message: "Banner created successfully",
    data: banner,
  });
}

export async function updateBannerHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as UpdateBannerInput;
  const banner = await updateBannerRecord(request.server.prisma, id, body);
  return reply.send({
    success: true,
    message: "Banner updated successfully",
    data: banner,
  });
}

export async function deleteBannerHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await deleteBannerRecord(request.server.prisma, id);
  return reply.send({
    success: true,
    message: "Banner deleted successfully",
  });
}

export async function uploadBannerImageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };

  const data = await request.file();
  if (!data) throw createHttpError(400, "No file uploaded");

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(data.mimetype)) {
    throw createHttpError(400, "Only JPEG, PNG, WebP, and GIF images are allowed");
  }

  const buffer = await data.toBuffer();
  const ext = data.filename.split(".").pop() ?? "jpg";
  const safeFilename = `banner-${Date.now()}.${ext}`;

  const imageUrl = await request.server.storage.uploadBannerImage({
    bannerId: id,
    filename: safeFilename,
    body: buffer,
    contentType: data.mimetype,
    contentLength: buffer.length,
  });

  const banner = await updateBannerRecord(request.server.prisma, id, { imageUrl });

  request.log.info({ bannerId: id, uploadedBy: request.user.sub, imageUrl }, "Banner image uploaded");

  return reply.send({
    success: true,
    message: "Image uploaded successfully",
    data: banner,
  });
}
