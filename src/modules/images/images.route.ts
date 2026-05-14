import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import { imageRef } from "./images.schema.js";
import {
  createImageHandler,
  deleteImageHandler,
  listImagesHandler,
  updateImageHandler,
  uploadImageFileHandler,
} from "./images.controller.js";

export async function imageRoutes(app: FastifyInstance) {
  app.get("/", {
    schema: {
      tags: ["Images"],
      querystring: imageRef("listImagesQuerySchema"),
      response: { 200: imageRef("paginatedImagesResponseSchema") },
    },
    preHandler: [app.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: listImagesHandler,
  });

  app.post("/", {
    schema: {
      tags: ["Images"],
      summary: "Upload a master image",
      consumes: ["multipart/form-data"],
      response: { 201: imageRef("singleImageResponseSchema") },
    },
    preHandler: [app.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: createImageHandler,
  });

  app.patch("/:uuid", {
    schema: {
      tags: ["Images"],
      params: imageRef("imageUuidParamSchema"),
      body: imageRef("updateImageBodySchema"),
      response: { 200: imageRef("singleImageResponseSchema") },
    },
    preHandler: [app.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: updateImageHandler,
  });

  app.post("/:uuid/file", {
    schema: {
      tags: ["Images"],
      summary: "Upload the file for existing image metadata",
      consumes: ["multipart/form-data"],
      params: imageRef("imageUuidParamSchema"),
      response: { 200: imageRef("singleImageResponseSchema") },
    },
    preHandler: [app.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: uploadImageFileHandler,
  });

  app.delete("/:uuid", {
    schema: {
      tags: ["Images"],
      params: imageRef("imageUuidParamSchema"),
      response: { 200: imageRef("deleteImageResponseSchema") },
    },
    preHandler: [app.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: deleteImageHandler,
  });
}
