import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const minioInstance = {
  bucketExists: jest.fn(),
  makeBucket: jest.fn(),
  setBucketPolicy: jest.fn(),
  putObject: jest.fn(),
  presignedGetObject: jest.fn(),
  removeObject: jest.fn(),
  statObject: jest.fn(),
};

const Client = jest.fn(() => minioInstance);

jest.unstable_mockModule("minio", () => ({ Client }));

const { createObjectStorage } = await import("../../src/lib/object-storage.js");

function createStorage(overrides: Record<string, unknown> = {}) {
  return createObjectStorage({
    endpointUrl: "https://s3.example.com/",
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
    ...overrides,
  });
}

describe("object storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    minioInstance.bucketExists.mockResolvedValue(false as never);
    minioInstance.makeBucket.mockResolvedValue(undefined as never);
    minioInstance.setBucketPolicy.mockResolvedValue(undefined as never);
    minioInstance.putObject.mockResolvedValue(undefined as never);
    minioInstance.presignedGetObject.mockResolvedValue("https://signed.example.com/photo" as never);
    minioInstance.removeObject.mockResolvedValue(undefined as never);
    minioInstance.statObject.mockResolvedValue({
      size: 42,
      lastModified: new Date("2026-05-01T10:00:00.000Z"),
      etag: "etag-1",
      metaData: { "content-type": "text/csv" },
    } as never);
  });

  it("creates a MinIO client from endpoint options and exposes configured limits", () => {
    const storage = createStorage({ endpointUrl: "http://localhost:9000" });

    expect(Client).toHaveBeenCalledWith({
      endPoint: "localhost",
      port: 9000,
      useSSL: false,
      accessKey: "access",
      secretKey: "secret",
      region: "ap-southeast-2",
    });
    expect(storage.profilePhotoMaxSizeBytes).toBe(1024);
    expect(storage.signedUrlExpiresInSeconds).toBe(300);
  });

  it("uses default endpoint ports for https and http URLs", () => {
    createStorage({ endpointUrl: "https://storage.example.com" });
    createStorage({ endpointUrl: "http://storage.example.com" });

    expect(Client).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ endPoint: "storage.example.com", port: 443, useSSL: true })
    );
    expect(Client).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ endPoint: "storage.example.com", port: 80, useSSL: false })
    );
  });

  it("ensures the private profile photo bucket and skips creation when present", async () => {
    const storage = createStorage();

    await storage.ensureProfilePhotoBucketExists();

    expect(minioInstance.bucketExists).toHaveBeenCalledWith("profile-photos");
    expect(minioInstance.makeBucket).toHaveBeenCalledWith("profile-photos", "ap-southeast-2");
    expect(minioInstance.setBucketPolicy).toHaveBeenCalledWith(
      "profile-photos",
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [],
        Id: "profile-photos-private",
      })
    );

    jest.clearAllMocks();
    minioInstance.bucketExists.mockResolvedValue(true as never);
    await storage.ensureProfilePhotoBucketExists();
    expect(minioInstance.makeBucket).not.toHaveBeenCalled();
    expect(minioInstance.setBucketPolicy).toHaveBeenCalled();
  });

  it("uploads, signs, and deletes profile photos", async () => {
    const storage = createStorage();
    const body = Buffer.from("photo");

    await storage.uploadProfilePhoto({
      key: "users/user-1/avatar.png",
      body,
      contentType: "image/png",
      contentLength: body.length,
    });
    const signedUrl = await storage.getProfilePhotoSignedUrl("users/user-1/avatar.png");
    await storage.deleteProfilePhoto("users/user-1/avatar.png");

    expect(minioInstance.putObject).toHaveBeenCalledWith("profile-photos", "users/user-1/avatar.png", body, body.length, {
      "Content-Type": "image/png",
    });
    expect(minioInstance.presignedGetObject).toHaveBeenCalledWith("profile-photos", "users/user-1/avatar.png", 300);
    expect(minioInstance.removeObject).toHaveBeenCalledWith("profile-photos", "users/user-1/avatar.png");
    expect(signedUrl).toBe("https://signed.example.com/photo");
  });

  it("stores invoice PDFs in a private bucket and returns signed download URLs", async () => {
    const storage = createStorage();
    const body = Buffer.from("%PDF");

    await storage.ensureInvoiceBucketExists();
    const key = await storage.uploadInvoicePdf({
      userId: "student-1",
      invoiceId: "in_123",
      body,
      contentLength: body.length,
    });
    const signedUrl = await storage.getInvoicePdfSignedUrl(key);

    expect(minioInstance.bucketExists).toHaveBeenCalledWith("invoices");
    expect(minioInstance.setBucketPolicy).toHaveBeenCalledWith(
      "invoices",
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [],
        Id: "invoices-private",
      })
    );
    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "invoices",
      "student-1/in_123.pdf",
      body,
      body.length,
      { "Content-Type": "application/pdf" }
    );
    expect(minioInstance.presignedGetObject).toHaveBeenCalledWith("invoices", "student-1/in_123.pdf", 300);
    expect(key).toBe("student-1/in_123.pdf");
    expect(signedUrl).toBe("https://signed.example.com/photo");
  });

  it("stores CSV templates in a private bucket and returns signed download URLs", async () => {
    const storage = createStorage();
    const body = Buffer.from("Header\nValue");

    await storage.ensureCsvTemplateBucketExists();
    await storage.uploadCsvTemplate({
      key: "question-mcq.csv",
      body,
      contentType: "text/csv",
      contentLength: body.length,
      downloadFileName: "question-mcq-template.csv",
    });
    const info = await storage.getCsvTemplateObjectInfo("question-mcq.csv");
    const signedUrl = await storage.getCsvTemplateSignedUrl("question-mcq.csv");

    expect(minioInstance.bucketExists).toHaveBeenCalledWith("csv-templates");
    expect(minioInstance.setBucketPolicy).toHaveBeenCalledWith(
      "csv-templates",
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [],
        Id: "csv-templates-private",
      })
    );
    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "csv-templates",
      "question-mcq.csv",
      body,
      body.length,
      {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="question-mcq-template.csv"',
      }
    );
    expect(minioInstance.statObject).toHaveBeenCalledWith("csv-templates", "question-mcq.csv");
    expect(minioInstance.presignedGetObject).toHaveBeenCalledWith("csv-templates", "question-mcq.csv", 300);
    expect(info.size).toBe(42);
    expect(info.contentType).toBe("text/csv");
    expect(signedUrl).toBe("https://signed.example.com/photo");
  });

  it("ensures public master, question, and banner image buckets", async () => {
    const storage = createStorage();

    await storage.ensureImageBucketExists();
    await storage.ensureQuestionImageBucketExists();
    await storage.ensureBannerImageBucketExists();

    expect(minioInstance.makeBucket).toHaveBeenCalledWith("images", "ap-southeast-2");
    expect(minioInstance.makeBucket).toHaveBeenCalledWith("question-images", "ap-southeast-2");
    expect(minioInstance.makeBucket).toHaveBeenCalledWith("banner-images", "ap-southeast-2");
    expect(minioInstance.setBucketPolicy).toHaveBeenCalledWith(
      "images",
      expect.stringContaining("arn:aws:s3:::images/*")
    );
    expect(minioInstance.setBucketPolicy).toHaveBeenCalledWith(
      "question-images",
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: ["arn:aws:s3:::question-images/*"],
          },
        ],
      })
    );
    expect(minioInstance.setBucketPolicy).toHaveBeenCalledWith(
      "banner-images",
      expect.stringContaining("arn:aws:s3:::banner-images/*")
    );
  });

  it("uploads passage, question, and banner images with public URLs", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1770000000000);
    const storage = createStorage({ endpointUrl: "https://s3.example.com/" });
    const body = Buffer.from("image");

    const passageUrl = await storage.uploadImage({
      imageType: "PASSAGE",
      key: "passage-1/diagram.png",
      body,
      contentType: "image/png",
      contentLength: body.length,
    });
    const questionUrl = await storage.uploadQuestionImage({
      questionId: "question-1",
      filename: "diagram.png",
      body,
      contentType: "image/png",
      contentLength: body.length,
    });
    const bannerUrl = await storage.uploadBannerImage({
      bannerId: "banner-1",
      filename: "hero.jpg",
      body,
      contentType: "image/jpeg",
      contentLength: body.length,
    });

    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "passages",
      "passage-1/diagram.png",
      body,
      body.length,
      { "Content-Type": "image/png" }
    );
    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "question-images",
      "question-1/1770000000000-diagram.png",
      body,
      body.length,
      { "Content-Type": "image/png" }
    );
    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "banner-images",
      "banner-1/1770000000000-hero.jpg",
      body,
      body.length,
      { "Content-Type": "image/jpeg" }
    );
    expect(passageUrl).toBe("https://s3.example.com/passages/passage-1/diagram.png");
    expect(questionUrl).toBe("https://s3.example.com/question-images/question-1/1770000000000-diagram.png");
    expect(bannerUrl).toBe("https://s3.example.com/banner-images/banner-1/1770000000000-hero.jpg");
  });

  it("can publish object URLs from a browser-facing endpoint", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1770000000001);
    const storage = createStorage({
      endpointUrl: "http://minio:9000",
      publicEndpointUrl: "https://assets.example.com/",
    });
    const body = Buffer.from("image");

    const bannerUrl = await storage.uploadBannerImage({
      bannerId: "banner-1",
      filename: "hero.jpg",
      body,
      contentType: "image/jpeg",
      contentLength: body.length,
    });

    expect(bannerUrl).toBe("https://assets.example.com/banner-images/banner-1/1770000000001-hero.jpg");
  });
});
