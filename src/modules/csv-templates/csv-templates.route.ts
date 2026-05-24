import type { FastifyInstance } from "fastify";
import { requireRole } from "../../utils/authz.js";
import {
  getCsvTemplateDownloadHandler,
  listCsvTemplatesHandler,
  uploadCsvTemplateHandler,
} from "./csv-templates.controller.js";
import { csvTemplateRef } from "./csv-templates.schema.js";

export async function csvTemplateRoutes(fastify: FastifyInstance) {
  fastify.get("/", {
    schema: {
      tags: ["CSV Templates"],
      summary: "List CSV import templates",
      response: { 200: csvTemplateRef("listCsvTemplatesResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: listCsvTemplatesHandler,
  });

  fastify.post("/", {
    schema: {
      tags: ["CSV Templates"],
      summary: "Upload a CSV import template",
      consumes: ["multipart/form-data"],
      response: { 201: csvTemplateRef("csvTemplateUploadResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN")],
    handler: uploadCsvTemplateHandler,
  });

  fastify.get("/:type/download", {
    schema: {
      tags: ["CSV Templates"],
      summary: "Generate a MinIO signed URL for a CSV import template",
      params: csvTemplateRef("csvTemplateParamSchema"),
      response: { 200: csvTemplateRef("csvTemplateDownloadResponseSchema") },
    },
    preHandler: [fastify.authenticate, requireRole("ADMIN", "TUTOR")],
    handler: getCsvTemplateDownloadHandler,
  });
}
