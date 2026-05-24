import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const multipartPlugin = jest.fn();
const storage = {
  ensureProfilePhotoBucketExists: jest.fn(),
  ensureImageBucketExists: jest.fn(),
  ensureQuestionImageBucketExists: jest.fn(),
  ensurePassageBucketExists: jest.fn(),
  ensureBannerImageBucketExists: jest.fn(),
  ensureResourceBucketExists: jest.fn(),
  ensureInvoiceBucketExists: jest.fn(),
  ensureCsvTemplateBucketExists: jest.fn(),
};
const createObjectStorage = jest.fn(() => storage);

const env = {
  S3_ENDPOINT: "https://s3.example.com",
  S3_PUBLIC_ENDPOINT: "https://assets.example.com",
  S3_ACCESS_KEY: "access",
  S3_SECRET_KEY: "secret",
  S3_REGION: "ap-southeast-2",
  S3_PROFILE_PHOTO_BUCKET: "profile-photos",
  S3_IMAGE_BUCKET: "images",
  S3_PASSAGE_BUCKET: "passages",
  PROFILE_PHOTO_MAX_SIZE_BYTES: 1024,
  IMAGE_MAX_SIZE_BYTES: 2048,
  RESOURCE_FILE_MAX_SIZE_BYTES: 1024,
  S3_SIGNED_URL_EXPIRES_IN_SECONDS: 300,
  S3_QUESTION_IMAGE_BUCKET: "question-images",
  S3_BANNER_IMAGE_BUCKET: "banner-images",
  BANNER_IMAGE_MAX_SIZE_BYTES: 2048,
  S3_RESOURCE_BUCKET: "resources",
  S3_INVOICE_BUCKET: "invoices",
  S3_CSV_TEMPLATE_BUCKET: "csv-templates",
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
    storage.ensureProfilePhotoBucketExists.mockResolvedValue(undefined as never);
    storage.ensureImageBucketExists.mockResolvedValue(undefined as never);
    storage.ensureQuestionImageBucketExists.mockResolvedValue(undefined as never);
    storage.ensurePassageBucketExists.mockResolvedValue(undefined as never);
    storage.ensureBannerImageBucketExists.mockResolvedValue(undefined as never);
    storage.ensureResourceBucketExists.mockResolvedValue(undefined as never);
    storage.ensureInvoiceBucketExists.mockResolvedValue(undefined as never);
    storage.ensureCsvTemplateBucketExists.mockResolvedValue(undefined as never);
  });

  it("registers multipart, creates object storage, initializes buckets, and decorates fastify", async () => {
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
      profilePhotoBucket: "profile-photos",
      profilePhotoMaxSizeBytes: 1024,
      signedUrlExpiresInSeconds: 300,
      imageBucket: "images",
      questionImageBucket: "question-images",
      passageBucket: "passages",
      bannerImageBucket: "banner-images",
      bannerImageMaxSizeBytes: 2048,
      resourceBucket: "resources",
      invoiceBucket: "invoices",
      csvTemplateBucket: "csv-templates",
    });
    expect(storage.ensureProfilePhotoBucketExists).toHaveBeenCalled();
    expect(storage.ensureImageBucketExists).toHaveBeenCalled();
    expect(storage.ensureQuestionImageBucketExists).toHaveBeenCalled();
    expect(storage.ensurePassageBucketExists).toHaveBeenCalled();
    expect(storage.ensureBannerImageBucketExists).toHaveBeenCalled();
    expect(storage.ensureResourceBucketExists).toHaveBeenCalled();
    expect(storage.ensureInvoiceBucketExists).toHaveBeenCalled();
    expect(storage.ensureCsvTemplateBucketExists).toHaveBeenCalled();
    expect(fastify.decorate).toHaveBeenCalledWith("storage", storage);
  });

  it("warns and continues when a bucket initialization check times out", async () => {
    const fastify = fakeFastify();
    env.S3_BUCKET_INIT_TIMEOUT_MS = 5;
    storage.ensureInvoiceBucketExists.mockImplementationOnce(
      () => new Promise(() => undefined) as never
    );

    await storagePlugin(fastify);

    expect(fastify.log.warn).toHaveBeenCalledWith(
      {
        bucket: "invoices",
        endpoint: "https://s3.example.com",
        timeoutMs: 5,
      },
      "Skipping MinIO invoice bucket existence check because the S3 endpoint did not respond before startup timeout"
    );
    expect(fastify.decorate).toHaveBeenCalledWith("storage", storage);
  });

  it("warns and continues when S3 redirects bucket checks", async () => {
    const fastify = fakeFastify();
    storage.ensureQuestionImageBucketExists.mockRejectedValueOnce({
      code: "MovedPermanently",
      message: "Wrong region",
    } as never);

    await storagePlugin(fastify);

    expect(fastify.log.warn).toHaveBeenCalledWith(
      {
        bucket: "question-images",
        endpoint: "https://s3.example.com",
        errorCode: "MovedPermanently",
        errorMessage: "Wrong region",
      },
      "Skipping MinIO question image bucket existence check because the S3 endpoint responded with a redirect"
    );
    expect(fastify.decorate).toHaveBeenCalledWith("storage", storage);
  });

  it("rethrows non-redirect bucket initialization errors", async () => {
    const error = new Error("S3 unavailable");
    storage.ensureBannerImageBucketExists.mockRejectedValueOnce(error as never);

    await expect(storagePlugin(fakeFastify())).rejects.toThrow("S3 unavailable");
  });
});
