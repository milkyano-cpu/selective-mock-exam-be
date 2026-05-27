import fastifyMultipart from "@fastify/multipart";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { createObjectStorage } from "../lib/object-storage.js";

const BUCKET_INIT_TIMEOUT_CODE = "BucketInitTimeout";

function createBucketInitTimeoutError() {
  const error = new Error(
    `Timed out initializing MinIO bucket "${env.S3_BUCKET}" after ${env.S3_BUCKET_INIT_TIMEOUT_MS}ms`
  ) as Error & { code: string };

  error.code = BUCKET_INIT_TIMEOUT_CODE;

  return error;
}

async function runBucketInitTask(fn: () => Promise<void>) {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(createBucketInitTimeoutError()),
          env.S3_BUCKET_INIT_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function storagePlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: Math.max(env.PROFILE_PHOTO_MAX_SIZE_BYTES, env.RESOURCE_FILE_MAX_SIZE_BYTES, env.IMAGE_MAX_SIZE_BYTES),
    },
  });

  const storage = createObjectStorage({
    endpointUrl: env.S3_ENDPOINT,
    publicEndpointUrl: env.S3_PUBLIC_ENDPOINT,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    profilePhotoMaxSizeBytes: env.PROFILE_PHOTO_MAX_SIZE_BYTES,
    signedUrlExpiresInSeconds: env.S3_SIGNED_URL_EXPIRES_IN_SECONDS,
  });

  try {
    await runBucketInitTask(() => storage.ensureBucketExists());
  } catch (error) {
    const storageError = error as { code?: string; message?: string };

    if (storageError.code === "MovedPermanently") {
      fastify.log.warn(
        {
          bucket: env.S3_BUCKET,
          endpoint: env.S3_ENDPOINT,
          errorCode: storageError.code,
          errorMessage: storageError.message,
        },
        "Skipping MinIO bucket existence check because the S3 endpoint responded with a redirect"
      );
    } else if (storageError.code === BUCKET_INIT_TIMEOUT_CODE) {
      fastify.log.warn(
        {
          bucket: env.S3_BUCKET,
          endpoint: env.S3_ENDPOINT,
          timeoutMs: env.S3_BUCKET_INIT_TIMEOUT_MS,
        },
        "Skipping MinIO bucket existence check because the S3 endpoint did not respond before startup timeout"
      );
    } else {
      throw error;
    }
  }

  fastify.decorate("storage", storage);
}

export default fp(storagePlugin, {
  name: "storage",
});
