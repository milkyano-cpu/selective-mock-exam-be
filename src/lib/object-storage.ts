import { Client } from "minio";

export interface UploadProfilePhotoInput {
  key: string;
  body: Buffer;
  contentType: string;
  contentLength: number;
}

export interface ObjectStorage {
  profilePhotoMaxSizeBytes: number;
  signedUrlExpiresInSeconds: number;
  ensureProfilePhotoBucketExists(): Promise<void>;
  uploadProfilePhoto(input: UploadProfilePhotoInput): Promise<void>;
  getProfilePhotoSignedUrl(key: string): Promise<string>;
  deleteProfilePhoto(key: string): Promise<void>;
}

interface CreateObjectStorageOptions {
  endpointUrl: string;
  accessKey: string;
  secretKey: string;
  region: string;
  profilePhotoBucket: string;
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

function buildPrivateBucketPolicy(bucketName: string) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [],
    Id: `${bucketName}-private`,
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
  };
}
