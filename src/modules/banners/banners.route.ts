import type { FastifyInstance } from "fastify";
import { bannerRef } from "./banners.schema.js";
import { requireRole } from "../../utils/authz.js";
import {
  getActiveBannersHandler,
  listBannersHandler,
  createBannerHandler,
  updateBannerHandler,
  deleteBannerHandler,
  uploadBannerImageHandler,
} from "./banners.controller.js";

export async function bannerRoutes(fastify: FastifyInstance) {
  // All authenticated users: get active banners for carousel
  fastify.get("/active", {
    schema: {
      response: { 200: bannerRef("getActiveBannersResponseSchema") },
    },
    preHandler: [fastify.authenticate],
    handler: getActiveBannersHandler,
  });

  // Admin only: list all banners (including inactive)
  fastify.get("/", {
    schema: {
      querystring: bannerRef("listBannersQuerySchema"),
      response: { 200: bannerRef("listBannersResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: listBannersHandler,
  });

  // Admin only: create banner
  fastify.post("/", {
    schema: {
      body: bannerRef("createBannerBodySchema"),
      response: { 201: bannerRef("createBannerResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: createBannerHandler,
  });

  // Admin only: update banner
  fastify.patch("/:id", {
    schema: {
      params: bannerRef("bannerIdParamSchema"),
      body: bannerRef("updateBannerBodySchema"),
      response: { 200: bannerRef("updateBannerResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: updateBannerHandler,
  });

  // Admin only: delete banner
  fastify.delete("/:id", {
    schema: {
      params: bannerRef("bannerIdParamSchema"),
      response: { 200: bannerRef("deleteBannerResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: deleteBannerHandler,
  });

  // Admin only: upload banner image
  fastify.post("/:id/image", {
    schema: {
      params: bannerRef("bannerIdParamSchema"),
      response: { 200: bannerRef("uploadBannerImageResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: uploadBannerImageHandler,
  });
}
