import { Client } from "minio";
import type { Readable } from "node:stream";

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
  profilePhotoMaxSizeBytes: number;
  signedUrlExpiresInSeconds: number;
  ensureProfilePhotoBucketExists(): Promise<void>;
  uploadProfilePhoto(input: UploadProfilePhotoInput): Promise<void>;
  getProfilePhotoSignedUrl(key: string): Promise<string>;
  deleteProfilePhoto(key: string): Promise<void>;
  ensureImageBucketExists(): Promise<void>;
  ensurePassageBucketExists(): Promise<void>;
  uploadImage(input: UploadImageInput): Promise<string>;
  deleteImageObject(key: string): Promise<void>;
  deleteObject(bucket: string, key: string): Promise<void>;
  ensureQuestionImageBucketExists(): Promise<void>;
  uploadQuestionImage(input: UploadQuestionImageInput): Promise<string>;
  ensureBannerImageBucketExists(): Promise<void>;
  uploadBannerImage(input: UploadBannerImageInput): Promise<string>;
  ensureResourceBucketExists(): Promise<void>;
  uploadResourceFile(input: UploadResourceFileInput): Promise<string>;
  getResourceFileObject(key: string): Promise<{ body: Readable; size?: number; contentType?: string }>;
  getResourceFileSignedUrl(key: string): Promise<string>;
  ensureInvoiceBucketExists(): Promise<void>;
  uploadInvoicePdf(input: UploadInvoicePdfInput): Promise<string>;
  getInvoicePdfSignedUrl(key: string): Promise<string>;
  ensureCsvTemplateBucketExists(): Promise<void>;
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
  profilePhotoBucket: string;
  profilePhotoMaxSizeBytes: number;
  signedUrlExpiresInSeconds: number;
  imageBucket: string;
  questionImageBucket: string;
  passageBucket: string;
  bannerImageBucket: string;
  bannerImageMaxSizeBytes: number;
  resourceBucket: string;
  invoiceBucket: string;
  csvTemplateBucket: string;
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

function buildPrivateBucketPolicy(bucketName: string) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [],
    Id: `${bucketName}-private`,
  });
}

function buildPublicReadBucketPolicy(bucketName: string) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucketName}/*`],
      },
    ],
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

  return {
    profilePhotoMaxSizeBytes: options.profilePhotoMaxSizeBytes,
    signedUrlExpiresInSeconds: options.signedUrlExpiresInSeconds,
    async ensureProfilePhotoBucketExists() {
      const bucketExists = await client.bucketExists(options.profilePhotoBucket);

      if (!bucketExists) {
        await client.makeBucket(options.profilePhotoBucket, options.region);
      }

      await client.setBucketPolicy(
        options.profilePhotoBucket,
        buildPrivateBucketPolicy(options.profilePhotoBucket)
      );
    },
    async uploadProfilePhoto(input) {
      await client.putObject(
        options.profilePhotoBucket,
        input.key,
        input.body,
        input.contentLength,
        {
          "Content-Type": input.contentType,
        }
      );
    },
    async getProfilePhotoSignedUrl(key) {
      return client.presignedGetObject(
        options.profilePhotoBucket,
        key,
        options.signedUrlExpiresInSeconds
      );
    },
    async deleteProfilePhoto(key) {
      await client.removeObject(options.profilePhotoBucket, key);
    },
    async ensureImageBucketExists() {
      const bucketExists = await client.bucketExists(options.imageBucket);

      if (!bucketExists) {
        await client.makeBucket(options.imageBucket, options.region);
      }

      await client.setBucketPolicy(
        options.imageBucket,
        buildPublicReadBucketPolicy(options.imageBucket)
      );
    },
    async ensurePassageBucketExists() {
      const bucketExists = await client.bucketExists(options.passageBucket);

      if (!bucketExists) {
        await client.makeBucket(options.passageBucket, options.region);
      }

      await client.setBucketPolicy(
        options.passageBucket,
        buildPublicReadBucketPolicy(options.passageBucket)
      );
    },
    async uploadImage(input) {
      const bucket = input.imageType === "PASSAGE"
        ? options.passageBucket
        : options.questionImageBucket;

      await client.putObject(
        bucket,
        input.key,
        input.body,
        input.contentLength,
        { "Content-Type": input.contentType }
      );

      return `${endpointBase}/${bucket}/${input.key}`;
    },
    async deleteImageObject(key) {
      await client.removeObject(options.imageBucket, key);
    },
    async deleteObject(bucket, key) {
      await client.removeObject(bucket, key);
    },
    async ensureQuestionImageBucketExists() {
      const bucketExists = await client.bucketExists(options.questionImageBucket);

      if (!bucketExists) {
        await client.makeBucket(options.questionImageBucket, options.region);
      }

      await client.setBucketPolicy(
        options.questionImageBucket,
        buildPublicReadBucketPolicy(options.questionImageBucket)
      );
    },
    async uploadQuestionImage(input) {
      const key = `${input.questionId}/${Date.now()}-${input.filename}`;

      await client.putObject(
        options.questionImageBucket,
        key,
        input.body,
        input.contentLength,
        { "Content-Type": input.contentType }
      );

      return `${endpointBase}/${options.questionImageBucket}/${key}`;
    },
    async ensureBannerImageBucketExists() {
      const bucketExists = await client.bucketExists(options.bannerImageBucket);

      if (!bucketExists) {
        await client.makeBucket(options.bannerImageBucket, options.region);
      }

      await client.setBucketPolicy(
        options.bannerImageBucket,
        buildPublicReadBucketPolicy(options.bannerImageBucket)
      );
    },
    async uploadBannerImage(input) {
      const key = `${input.bannerId}/${Date.now()}-${input.filename}`;

      await client.putObject(
        options.bannerImageBucket,
        key,
        input.body,
        input.contentLength,
        { "Content-Type": input.contentType }
      );

      return `${endpointBase}/${options.bannerImageBucket}/${key}`;
    },
    async ensureResourceBucketExists() {
      const bucketExists = await client.bucketExists(options.resourceBucket);

      if (!bucketExists) {
        await client.makeBucket(options.resourceBucket, options.region);
      }

      await client.setBucketPolicy(
        options.resourceBucket,
        buildPublicReadBucketPolicy(options.resourceBucket)
      );
    },
    async uploadResourceFile(input) {
      const key = `${input.resourceId}/${input.filename}`;

      await client.putObject(
        options.resourceBucket,
        key,
        input.body,
        input.contentLength,
        { "Content-Type": input.contentType }
      );

      return `${endpointBase}/${options.resourceBucket}/${key}`;
    },
    async getResourceFileObject(key) {
      const [stat, body] = await Promise.all([
        client.statObject(options.resourceBucket, key),
        client.getObject(options.resourceBucket, key),
      ]);

      return {
        body,
        size: stat.size,
        contentType: stat.metaData?.["content-type"],
      };
    },
    async getResourceFileSignedUrl(key) {
      return client.presignedGetObject(
        options.resourceBucket,
        key,
        options.signedUrlExpiresInSeconds
      );
    },
    async ensureInvoiceBucketExists() {
      const bucketExists = await client.bucketExists(options.invoiceBucket);

      if (!bucketExists) {
        await client.makeBucket(options.invoiceBucket, options.region);
      }

      await client.setBucketPolicy(
        options.invoiceBucket,
        buildPrivateBucketPolicy(options.invoiceBucket)
      );
    },
    async uploadInvoicePdf(input) {
      const key = `${input.userId}/${input.invoiceId}.pdf`;

      await client.putObject(
        options.invoiceBucket,
        key,
        input.body,
        input.contentLength,
        { "Content-Type": "application/pdf" }
      );

      return key;
    },
    async getInvoicePdfSignedUrl(key) {
      return client.presignedGetObject(
        options.invoiceBucket,
        key,
        options.signedUrlExpiresInSeconds
      );
    },
    async ensureCsvTemplateBucketExists() {
      const bucketExists = await client.bucketExists(options.csvTemplateBucket);

      if (!bucketExists) {
        await client.makeBucket(options.csvTemplateBucket, options.region);
      }

      await client.setBucketPolicy(
        options.csvTemplateBucket,
        buildPrivateBucketPolicy(options.csvTemplateBucket)
      );
    },
    async uploadCsvTemplate(input) {
      await client.putObject(
        options.csvTemplateBucket,
        input.key,
        input.body,
        input.contentLength,
        {
          "Content-Type": input.contentType,
          "Content-Disposition": `attachment; filename="${input.downloadFileName}"`,
        }
      );
    },
    async getCsvTemplateSignedUrl(key) {
      return client.presignedGetObject(
        options.csvTemplateBucket,
        key,
        options.signedUrlExpiresInSeconds
      );
    },
    async getCsvTemplateObjectInfo(key) {
      const stat = await client.statObject(options.csvTemplateBucket, key);
      const info: StoredObjectInfo = { size: stat.size };
      const contentType = stat.metaData?.["content-type"];

      if (stat.lastModified) info.lastModified = stat.lastModified;
      if (stat.etag) info.etag = stat.etag;
      if (contentType) info.contentType = contentType;

      return info;
    },
  };
}
