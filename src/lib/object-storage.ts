import { Client } from "minio";
import type { Readable } from "node:stream";

export const STORAGE_PREFIXES = {
  PROFILE_PHOTO: "profile-photos",
  IMAGE: "images",
  QUESTION_IMAGE: "questions",
  PASSAGE: "passages",
  BANNER_IMAGE: "banners",
  RESOURCE: "resources",
  INVOICE: "invoices",
  CSV_TEMPLATE: "csv-templates",
} as const;

const PUBLIC_READ_PREFIXES: readonly string[] = [
  STORAGE_PREFIXES.IMAGE,
  STORAGE_PREFIXES.QUESTION_IMAGE,
  STORAGE_PREFIXES.PASSAGE,
  STORAGE_PREFIXES.BANNER_IMAGE,
  STORAGE_PREFIXES.RESOURCE,
];

export interface UploadProfilePhotoInput {
  key: string;
  body: Buffer;
  contentType: string;
  contentLength: number;
}

export interface UploadQuestionImageInput {
  questionId: string;
  filename: string;
  body: Buffer;
  contentType: string;
  contentLength: number;
}

export interface UploadImageInput {
  imageType: "QUESTION" | "PASSAGE";
  key: string;
  body: Buffer;
  contentType: string;
  contentLength: number;
}

export interface UploadBannerImageInput {
  bannerId: string;
  filename: string;
  body: Buffer;
  contentType: string;
  contentLength: number;
}

export interface UploadResourceFileInput {
  resourceId: string;
  filename: string;
  body: Buffer;
  contentType: string;
  contentLength: number;
}

export interface UploadInvoicePdfInput {
  userId: string;
  invoiceId: string;
  body: Buffer;
  contentLength: number;
}

export interface UploadCsvTemplateInput {
  key: string;
  body: Buffer;
  contentType: string;
  contentLength: number;
  downloadFileName: string;
}

export interface StoredObjectInfo {
  size: number;
  lastModified?: Date;
  etag?: string;
  contentType?: string;
}

export interface ObjectStorage {
  bucket: string;
  profilePhotoMaxSizeBytes: number;
  signedUrlExpiresInSeconds: number;
  ensureBucketExists(): Promise<void>;
  uploadProfilePhoto(input: UploadProfilePhotoInput): Promise<void>;
  getProfilePhotoSignedUrl(key: string): Promise<string>;
  deleteProfilePhoto(key: string): Promise<void>;
  uploadImage(input: UploadImageInput): Promise<string>;
  deleteObject(key: string): Promise<void>;
  uploadQuestionImage(input: UploadQuestionImageInput): Promise<string>;
  uploadBannerImage(input: UploadBannerImageInput): Promise<string>;
  uploadResourceFile(input: UploadResourceFileInput): Promise<string>;
  getResourceFileObject(key: string): Promise<{ body: Readable; size?: number; contentType?: string }>;
  getResourceFileSignedUrl(key: string): Promise<string>;
  uploadInvoicePdf(input: UploadInvoicePdfInput): Promise<string>;
  getInvoicePdfSignedUrl(key: string): Promise<string>;
  uploadCsvTemplate(input: UploadCsvTemplateInput): Promise<void>;
  getCsvTemplateSignedUrl(key: string): Promise<string>;
  getCsvTemplateObjectInfo(key: string): Promise<StoredObjectInfo>;
}

interface CreateObjectStorageOptions {
  endpointUrl: string;
  publicEndpointUrl?: string | undefined;
  accessKey: string;
  secretKey: string;
  region: string;
  bucket: string;
  profilePhotoMaxSizeBytes: number;
  signedUrlExpiresInSeconds: number;
}

function parseEndpointUrl(endpointUrl: string) {
  const parsedUrl = new URL(endpointUrl);
  const useSSL = parsedUrl.protocol === "https:";
  const port = parsedUrl.port
    ? Number(parsedUrl.port)
    : useSSL
      ? 443
      : 80;

  return {
    endPoint: parsedUrl.hostname,
    port,
    useSSL,
  };
}

function buildBucketPolicy(bucket: string) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: PUBLIC_READ_PREFIXES.map((prefix) => `arn:aws:s3:::${bucket}/${prefix}/*`),
      },
    ],
    Id: `${bucket}-mixed-access`,
  });
}

export function createObjectStorage(
  options: CreateObjectStorageOptions
): ObjectStorage {
  const client = new Client({
    ...parseEndpointUrl(options.endpointUrl),
    accessKey: options.accessKey,
    secretKey: options.secretKey,
    region: options.region,
  });

  const endpointBase = (options.publicEndpointUrl ?? options.endpointUrl).replace(/\/$/, "");
  const { bucket } = options;

  const prefixedKey = (prefix: string, key: string) => `${prefix}/${key}`;
  const publicUrlFor = (key: string) => `${endpointBase}/${bucket}/${key}`;

  return {
    bucket,
    profilePhotoMaxSizeBytes: options.profilePhotoMaxSizeBytes,
    signedUrlExpiresInSeconds: options.signedUrlExpiresInSeconds,

    async ensureBucketExists() {
      const exists = await client.bucketExists(bucket);
      if (!exists) {
        await client.makeBucket(bucket, options.region);
      }
      await client.setBucketPolicy(bucket, buildBucketPolicy(bucket));
    },

    async uploadProfilePhoto(input) {
      await client.putObject(bucket, input.key, input.body, input.contentLength, {
        "Content-Type": input.contentType,
      });
    },
    async getProfilePhotoSignedUrl(key) {
      return client.presignedGetObject(bucket, key, options.signedUrlExpiresInSeconds);
    },
    async deleteProfilePhoto(key) {
      await client.removeObject(bucket, key);
    },

    async uploadImage(input) {
      const prefix = input.imageType === "PASSAGE"
        ? STORAGE_PREFIXES.PASSAGE
        : STORAGE_PREFIXES.QUESTION_IMAGE;
      const key = prefixedKey(prefix, input.key);

      await client.putObject(bucket, key, input.body, input.contentLength, {
        "Content-Type": input.contentType,
      });

      return publicUrlFor(key);
    },
    async deleteObject(key) {
      await client.removeObject(bucket, key);
    },

    async uploadQuestionImage(input) {
      const key = prefixedKey(
        STORAGE_PREFIXES.QUESTION_IMAGE,
        `${input.questionId}/${Date.now()}-${input.filename}`
      );

      await client.putObject(bucket, key, input.body, input.contentLength, {
        "Content-Type": input.contentType,
      });

      return publicUrlFor(key);
    },

    async uploadBannerImage(input) {
      const key = prefixedKey(
        STORAGE_PREFIXES.BANNER_IMAGE,
        `${input.bannerId}/${Date.now()}-${input.filename}`
      );

      await client.putObject(bucket, key, input.body, input.contentLength, {
        "Content-Type": input.contentType,
      });

      return publicUrlFor(key);
    },

    async uploadResourceFile(input) {
      const key = prefixedKey(STORAGE_PREFIXES.RESOURCE, `${input.resourceId}/${input.filename}`);

      await client.putObject(bucket, key, input.body, input.contentLength, {
        "Content-Type": input.contentType,
      });

      return publicUrlFor(key);
    },
    async getResourceFileObject(key) {
      const [stat, body] = await Promise.all([
        client.statObject(bucket, key),
        client.getObject(bucket, key),
      ]);

      return {
        body,
        size: stat.size,
        contentType: stat.metaData?.["content-type"],
      };
    },
    async getResourceFileSignedUrl(key) {
      return client.presignedGetObject(bucket, key, options.signedUrlExpiresInSeconds);
    },

    async uploadInvoicePdf(input) {
      const key = prefixedKey(STORAGE_PREFIXES.INVOICE, `${input.userId}/${input.invoiceId}.pdf`);

      await client.putObject(bucket, key, input.body, input.contentLength, {
        "Content-Type": "application/pdf",
      });

      return key;
    },
    async getInvoicePdfSignedUrl(key) {
      return client.presignedGetObject(bucket, key, options.signedUrlExpiresInSeconds);
    },

    async uploadCsvTemplate(input) {
      await client.putObject(bucket, input.key, input.body, input.contentLength, {
        "Content-Type": input.contentType,
        "Content-Disposition": `attachment; filename="${input.downloadFileName}"`,
      });
    },
    async getCsvTemplateSignedUrl(key) {
      return client.presignedGetObject(bucket, key, options.signedUrlExpiresInSeconds);
    },
    async getCsvTemplateObjectInfo(key) {
      const stat = await client.statObject(bucket, key);
      const info: StoredObjectInfo = { size: stat.size };
      const contentType = stat.metaData?.["content-type"];

      if (stat.lastModified) info.lastModified = stat.lastModified;
      if (stat.etag) info.etag = stat.etag;
      if (contentType) info.contentType = contentType;

      return info;
    },
  };
}
