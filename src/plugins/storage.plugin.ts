import fastifyMultipart from "@fastify/multipart";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { createObjectStorage } from "../lib/object-storage.js";

const BUCKET_INIT_TIMEOUT_CODE = "BucketInitTimeout";

type BucketInitTask = {
  name: string;
  fn: () => Promise<void>;
  bucket: string;
};

function createBucketInitTimeoutError(task: BucketInitTask) {
  const error = new Error(
    `Timed out initializing MinIO ${task.name} bucket after ${env.S3_BUCKET_INIT_TIMEOUT_MS}ms`
  ) as Error & { code: string };

  error.code = BUCKET_INIT_TIMEOUT_CODE;

  return error;
}

async function runBucketInitTask(task: BucketInitTask) {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      task.fn(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(createBucketInitTimeoutError(task)),
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
    profilePhotoBucket: env.S3_PROFILE_PHOTO_BUCKET,
    profilePhotoMaxSizeBytes: env.PROFILE_PHOTO_MAX_SIZE_BYTES,
    signedUrlExpiresInSeconds: env.S3_SIGNED_URL_EXPIRES_IN_SECONDS,
    imageBucket: env.S3_IMAGE_BUCKET,
    questionImageBucket: env.S3_QUESTION_IMAGE_BUCKET,
    passageBucket: env.S3_PASSAGE_BUCKET,
    bannerImageBucket: env.S3_BANNER_IMAGE_BUCKET,
    bannerImageMaxSizeBytes: env.BANNER_IMAGE_MAX_SIZE_BYTES,
    resourceBucket: env.S3_RESOURCE_BUCKET,
    invoiceBucket: env.S3_INVOICE_BUCKET,
  });

  const bucketInitTasks = [
    { name: "profile photo", fn: () => storage.ensureProfilePhotoBucketExists(), bucket: env.S3_PROFILE_PHOTO_BUCKET },
    { name: "master image", fn: () => storage.ensureImageBucketExists(), bucket: env.S3_IMAGE_BUCKET },
    { name: "question image", fn: () => storage.ensureQuestionImageBucketExists(), bucket: env.S3_QUESTION_IMAGE_BUCKET },
    { name: "passage image", fn: () => storage.ensurePassageBucketExists(), bucket: env.S3_PASSAGE_BUCKET },
    { name: "banner image", fn: () => storage.ensureBannerImageBucketExists(), bucket: env.S3_BANNER_IMAGE_BUCKET },
    { name: "resource", fn: () => storage.ensureResourceBucketExists(), bucket: env.S3_RESOURCE_BUCKET },
    { name: "invoice", fn: () => storage.ensureInvoiceBucketExists(), bucket: env.S3_INVOICE_BUCKET },
  ];

  await Promise.all(bucketInitTasks.map(async (task) => {
    try {
      await runBucketInitTask(task);
    } catch (error) {
      const storageError = error as { code?: string; message?: string };

      if (storageError.code === "MovedPermanently") {
        fastify.log.warn(
          {
            bucket: task.bucket,
            endpoint: env.S3_ENDPOINT,
            errorCode: storageError.code,
            errorMessage: storageError.message,
          },
          `Skipping MinIO ${task.name} bucket existence check because the S3 endpoint responded with a redirect`
        );
      } else if (storageError.code === BUCKET_INIT_TIMEOUT_CODE) {
        fastify.log.warn(
          {
            bucket: task.bucket,
            endpoint: env.S3_ENDPOINT,
            timeoutMs: env.S3_BUCKET_INIT_TIMEOUT_MS,
          },
          `Skipping MinIO ${task.name} bucket existence check because the S3 endpoint did not respond before startup timeout`
        );
      } else {
        throw error;
      }
    }
  }));

  fastify.decorate("storage", storage);
}

export default fp(storagePlugin, {
  name: "storage",
});
