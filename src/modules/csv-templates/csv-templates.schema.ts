import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";
import { CSV_TEMPLATE_TYPE_VALUES } from "./csv-templates.constants.js";

const csvTemplateTypeSchema = z.enum(CSV_TEMPLATE_TYPE_VALUES);

const csvTemplateParamSchema = z.object({
  type: csvTemplateTypeSchema,
});

const csvTemplateItemSchema = z.object({
  type: csvTemplateTypeSchema,
  label: z.string(),
  fileName: z.string(),
  objectKey: z.string(),
  available: z.boolean(),
  size: z.number().int().nonnegative().nullable(),
  lastModified: z.string().nullable(),
  contentType: z.string().nullable(),
});

const csvTemplateDownloadSchema = z.object({
  type: csvTemplateTypeSchema,
  label: z.string(),
  fileName: z.string(),
  url: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
});

const listCsvTemplatesResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(csvTemplateItemSchema),
});

const csvTemplateUploadResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: csvTemplateItemSchema,
});

const csvTemplateDownloadResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: csvTemplateDownloadSchema,
});

export type CsvTemplateParams = z.infer<typeof csvTemplateParamSchema>;

export const { schemas: csvTemplateSchemas, $ref: csvTemplateRef } = buildJsonSchemas({
  csvTemplateParamSchema,
  listCsvTemplatesResponseSchema,
  csvTemplateUploadResponseSchema,
  csvTemplateDownloadResponseSchema,
});
