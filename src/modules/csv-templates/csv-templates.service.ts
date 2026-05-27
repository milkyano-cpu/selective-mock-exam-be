import { STORAGE_PREFIXES, type ObjectStorage, type StoredObjectInfo } from "../../lib/object-storage.js";
import { createHttpError } from "../../utils/http-error.js";
import {
  CSV_TEMPLATE_DEFINITIONS,
  getCsvTemplateDefinition,
  type CsvTemplateType,
} from "./csv-templates.constants.js";

const MAX_CSV_TEMPLATE_SIZE_BYTES = 2 * 1024 * 1024;

type CsvTemplateDefinition = (typeof CSV_TEMPLATE_DEFINITIONS)[number];

export interface CsvTemplateItem {
  type: CsvTemplateType;
  label: string;
  fileName: string;
  objectKey: string;
  available: boolean;
  size: number | null;
  lastModified: string | null;
  contentType: string | null;
}

export interface CsvTemplateUploadInput {
  type: string;
  filename: string;
  body: Buffer;
  contentType: string;
}

function templateObjectKey(type: CsvTemplateType) {
  return `${STORAGE_PREFIXES.CSV_TEMPLATE}/${type}.csv`;
}

function isStorageNotFoundError(error: unknown) {
  const code = (error as { code?: string })?.code;
  return code === "NotFound" || code === "NoSuchKey" || code === "NoSuchObject";
}

function toTemplateItem(
  definition: CsvTemplateDefinition,
  info?: StoredObjectInfo
): CsvTemplateItem {
  return {
    type: definition.type,
    label: definition.label,
    fileName: definition.fileName,
    objectKey: templateObjectKey(definition.type),
    available: Boolean(info),
    size: info?.size ?? null,
    lastModified: info?.lastModified?.toISOString() ?? null,
    contentType: info?.contentType ?? null,
  };
}

async function getTemplateInfoOrNull(storage: ObjectStorage, type: CsvTemplateType) {
  try {
    return await storage.getCsvTemplateObjectInfo(templateObjectKey(type));
  } catch (error) {
    if (isStorageNotFoundError(error)) return null;
    throw error;
  }
}

function resolveTemplateDefinition(type: string) {
  const definition = getCsvTemplateDefinition(type);
  if (!definition) throw createHttpError(400, "Invalid CSV template type");
  return definition;
}

export async function listCsvTemplates(storage: ObjectStorage) {
  return Promise.all(
    CSV_TEMPLATE_DEFINITIONS.map(async (definition) => {
      const info = await getTemplateInfoOrNull(storage, definition.type);
      return toTemplateItem(definition, info ?? undefined);
    })
  );
}

export async function uploadCsvTemplate(
  storage: ObjectStorage,
  input: CsvTemplateUploadInput
) {
  const definition = resolveTemplateDefinition(input.type);

  if (!input.filename.toLowerCase().endsWith(".csv")) {
    throw createHttpError(400, "Uploaded file must be a CSV");
  }

  if (input.body.length > MAX_CSV_TEMPLATE_SIZE_BYTES) {
    throw createHttpError(400, "CSV template exceeds maximum size of 2 MB");
  }

  await storage.uploadCsvTemplate({
    key: templateObjectKey(definition.type),
    body: input.body,
    contentType: input.contentType || "text/csv",
    contentLength: input.body.length,
    downloadFileName: definition.fileName,
  });

  const info = await getTemplateInfoOrNull(storage, definition.type);
  return toTemplateItem(definition, info ?? {
    size: input.body.length,
    contentType: input.contentType || "text/csv",
  });
}

export async function getCsvTemplateDownload(
  storage: ObjectStorage,
  type: string
) {
  const definition = resolveTemplateDefinition(type);
  const info = await getTemplateInfoOrNull(storage, definition.type);
  if (!info) throw createHttpError(404, "CSV template has not been uploaded yet");

  return {
    type: definition.type,
    label: definition.label,
    fileName: definition.fileName,
    url: await storage.getCsvTemplateSignedUrl(templateObjectKey(definition.type)),
    expiresInSeconds: storage.signedUrlExpiresInSeconds,
  };
}
