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

export interface ObjectStorage {
  profilePhotoMaxSizeBytes: number;
  signedUrlExpiresInSeconds: number;
  ensureProfilePhotoBucketExists(): Promise<void>;
  uploadProfilePhoto(input: UploadProfilePhotoInput): Promise<void>;
  getProfilePhotoSignedUrl(key: string): Promise<string>;
  deleteProfilePhoto(key: string): Promise<void>;
  ensureQuestionImageBucketExists(): Promise<void>;
  uploadQuestionImage(input: UploadQuestionImageInput): Promise<string>;
  ensureBannerImageBucketExists(): Promise<void>;
  uploadBannerImage(input: UploadBannerImageInput): Promise<string>;
  ensureResourceBucketExists(): Promise<void>;
  uploadResourceFile(input: UploadResourceFileInput): Promise<string>;
  getResourceFileObject(key: string): Promise<{ body: Readable; size?: number; contentType?: string }>;
  ensureInvoiceBucketExists(): Promise<void>;
  uploadInvoicePdf(input: UploadInvoicePdfInput): Promise<string>;
  getInvoicePdfSignedUrl(key: string): Promise<string>;
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
  questionImageBucket: string;
  bannerImageBucket: string;
  bannerImageMaxSizeBytes: number;
  resourceBucket: string;
  invoiceBucket: string;
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
  };
}
