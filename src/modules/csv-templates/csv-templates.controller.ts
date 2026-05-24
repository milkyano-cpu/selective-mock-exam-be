import type { FastifyReply, FastifyRequest } from "fastify";
import { createHttpError } from "../../utils/http-error.js";
import type { CsvTemplateParams } from "./csv-templates.schema.js";
import {
  getCsvTemplateDownload,
  listCsvTemplates,
  uploadCsvTemplate,
} from "./csv-templates.service.js";

type MultipartFields = Record<string, { value?: unknown } | undefined>;

function getMultipartField(fields: MultipartFields | undefined, name: string) {
  const value = fields?.[name]?.value;
  return typeof value === "string" ? value.trim() : undefined;
}

export async function listCsvTemplatesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const templates = await listCsvTemplates(request.server.storage);
  return reply.send({
    success: true,
    message: "CSV templates retrieved",
    data: templates,
  });
}

export async function uploadCsvTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const data = await request.file();
  if (!data) throw createHttpError(400, "CSV file is required");

  const fields = (data as { fields?: MultipartFields }).fields;
  const templateType = getMultipartField(fields, "templateType") ?? getMultipartField(fields, "type");
  if (!templateType) throw createHttpError(400, "templateType is required");

  const buffer = await data.toBuffer();
  const template = await uploadCsvTemplate(request.server.storage, {
    type: templateType,
    filename: data.filename,
    body: buffer,
    contentType: data.mimetype,
  });

  request.log.info(
    { templateType, uploadedBy: request.user.sub, size: buffer.length },
    "CSV template uploaded"
  );

  return reply.status(201).send({
    success: true,
    message: "CSV template uploaded",
    data: template,
  });
}

export async function getCsvTemplateDownloadHandler(
  request: FastifyRequest<{ Params: CsvTemplateParams }>,
  reply: FastifyReply
) {
  const download = await getCsvTemplateDownload(request.server.storage, request.params.type);
  return reply.send({
    success: true,
    message: "CSV template download URL generated",
    data: download,
  });
}
