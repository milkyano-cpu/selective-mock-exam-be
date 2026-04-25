import fastifyMultipart from "@fastify/multipart";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { createObjectStorage } from "../lib/object-storage.js";

async function storagePlugin(fastify: FastifyInstance) {
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: env.PROFILE_PHOTO_MAX_SIZE_BYTES,
    },
  });

  const storage = createObjectStorage({
    endpointUrl: env.S3_ENDPOINT,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    region: env.S3_REGION,
    profilePhotoBucket: env.S3_PROFILE_PHOTO_BUCKET,
    profilePhotoMaxSizeBytes: env.PROFILE_PHOTO_MAX_SIZE_BYTES,
    signedUrlExpiresInSeconds: env.S3_SIGNED_URL_EXPIRES_IN_SECONDS,
  });

  try {
    await storage.ensureProfilePhotoBucketExists();
  } catch (error) {
    const storageError = error as { code?: string; message?: string };

    if (storageError.code === "MovedPermanently") {
      fastify.log.warn(
        {
          bucket: env.S3_PROFILE_PHOTO_BUCKET,
          endpoint: env.S3_ENDPOINT,
          errorCode: storageError.code,
          errorMessage: storageError.message,
        },
        "Skipping MinIO bucket existence check because the S3 endpoint responded with a redirect"
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
