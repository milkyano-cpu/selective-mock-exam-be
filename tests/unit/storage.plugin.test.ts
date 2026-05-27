import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const multipartPlugin = jest.fn();
const storage = {
  ensureBucketExists: jest.fn(),
};
const createObjectStorage = jest.fn(() => storage);

const env = {
  S3_ENDPOINT: "https://s3.example.com",
  S3_PUBLIC_ENDPOINT: "https://assets.example.com",
  S3_ACCESS_KEY: "access",
  S3_SECRET_KEY: "secret",
  S3_REGION: "ap-southeast-2",
  S3_BUCKET: "aspire-test",
  PROFILE_PHOTO_MAX_SIZE_BYTES: 1024,
  IMAGE_MAX_SIZE_BYTES: 2048,
  RESOURCE_FILE_MAX_SIZE_BYTES: 1024,
  S3_SIGNED_URL_EXPIRES_IN_SECONDS: 300,
  S3_BUCKET_INIT_TIMEOUT_MS: 3000,
};

jest.unstable_mockModule("@fastify/multipart", () => ({ default: multipartPlugin }));
jest.unstable_mockModule("fastify-plugin", () => ({ default: (plugin: unknown) => plugin }));
jest.unstable_mockModule("../../src/config/env.js", () => ({ env }));
jest.unstable_mockModule("../../src/lib/object-storage.js", () => ({ createObjectStorage }));

const storagePlugin = (await import("../../src/plugins/storage.plugin.js")).default as (
  fastify: ReturnType<typeof fakeFastify>
) => Promise<void>;

function fakeFastify() {
  return {
    register: jest.fn(async () => undefined),
    decorate: jest.fn(),
    log: { warn: jest.fn() },
  };
}

describe("storage plugin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    env.S3_BUCKET_INIT_TIMEOUT_MS = 3000;
    storage.ensureBucketExists.mockResolvedValue(undefined as never);
  });

  it("registers multipart, creates object storage with the single bucket, initializes it, and decorates fastify", async () => {
    const fastify = fakeFastify();

    await storagePlugin(fastify);

    expect(fastify.register).toHaveBeenCalledWith(multipartPlugin, {
      limits: { fileSize: 2048 },
    });
    expect(createObjectStorage).toHaveBeenCalledWith({
      endpointUrl: "https://s3.example.com",
      publicEndpointUrl: "https://assets.example.com",
      accessKey: "access",
      secretKey: "secret",
      region: "ap-southeast-2",
      bucket: "aspire-test",
      profilePhotoMaxSizeBytes: 1024,
      signedUrlExpiresInSeconds: 300,
    });
    expect(storage.ensureBucketExists).toHaveBeenCalledTimes(1);
    expect(fastify.decorate).toHaveBeenCalledWith("storage", storage);
  });

  it("warns and continues when bucket initialization times out", async () => {
    const fastify = fakeFastify();
    env.S3_BUCKET_INIT_TIMEOUT_MS = 5;
    storage.ensureBucketExists.mockImplementationOnce(
      () => new Promise(() => undefined) as never
    );

    await storagePlugin(fastify);

    expect(fastify.log.warn).toHaveBeenCalledWith(
      {
        bucket: "aspire-test",
        endpoint: "https://s3.example.com",
        timeoutMs: 5,
      },
      "Skipping MinIO bucket existence check because the S3 endpoint did not respond before startup timeout"
    );
    expect(fastify.decorate).toHaveBeenCalledWith("storage", storage);
  });

  it("warns and continues when S3 redirects the bucket check", async () => {
    const fastify = fakeFastify();
    storage.ensureBucketExists.mockRejectedValueOnce({
      code: "MovedPermanently",
      message: "Wrong region",
    } as never);

    await storagePlugin(fastify);

    expect(fastify.log.warn).toHaveBeenCalledWith(
      {
        bucket: "aspire-test",
        endpoint: "https://s3.example.com",
        errorCode: "MovedPermanently",
        errorMessage: "Wrong region",
      },
      "Skipping MinIO bucket existence check because the S3 endpoint responded with a redirect"
    );
    expect(fastify.decorate).toHaveBeenCalledWith("storage", storage);
  });

  it("rethrows non-redirect bucket initialization errors", async () => {
    const error = new Error("S3 unavailable");
    storage.ensureBucketExists.mockRejectedValueOnce(error as never);

    await expect(storagePlugin(fakeFastify())).rejects.toThrow("S3 unavailable");
  });
});
