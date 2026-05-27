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

const { createObjectStorage, STORAGE_PREFIXES } = await import("../../src/lib/object-storage.js");

function createStorage(overrides: Record<string, unknown> = {}) {
  return createObjectStorage({
    endpointUrl: "https://s3.example.com/",
    accessKey: "access",
    secretKey: "secret",
    region: "ap-southeast-2",
    bucket: "aspire-test",
    profilePhotoMaxSizeBytes: 1024,
    signedUrlExpiresInSeconds: 300,
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
    expect(storage.bucket).toBe("aspire-test");
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

  it("creates the single bucket and applies a mixed-access policy that only grants public read to public prefixes", async () => {
    const storage = createStorage();

    await storage.ensureBucketExists();

    expect(minioInstance.bucketExists).toHaveBeenCalledWith("aspire-test");
    expect(minioInstance.makeBucket).toHaveBeenCalledWith("aspire-test", "ap-southeast-2");

    const policyArg = minioInstance.setBucketPolicy.mock.calls[0]?.[1];
    expect(typeof policyArg).toBe("string");
    const policy = JSON.parse(policyArg as string);
    expect(policy.Statement[0].Action).toEqual(["s3:GetObject"]);
    const resources = policy.Statement[0].Resource as string[];
    expect(resources).toEqual(
      expect.arrayContaining([
        `arn:aws:s3:::aspire-test/${STORAGE_PREFIXES.IMAGE}/*`,
        `arn:aws:s3:::aspire-test/${STORAGE_PREFIXES.QUESTION_IMAGE}/*`,
        `arn:aws:s3:::aspire-test/${STORAGE_PREFIXES.PASSAGE}/*`,
        `arn:aws:s3:::aspire-test/${STORAGE_PREFIXES.BANNER_IMAGE}/*`,
        `arn:aws:s3:::aspire-test/${STORAGE_PREFIXES.RESOURCE}/*`,
      ])
    );
    // Private prefixes must NOT appear in the public-read policy
    expect(resources).not.toEqual(expect.arrayContaining([
      `arn:aws:s3:::aspire-test/${STORAGE_PREFIXES.PROFILE_PHOTO}/*`,
      `arn:aws:s3:::aspire-test/${STORAGE_PREFIXES.INVOICE}/*`,
      `arn:aws:s3:::aspire-test/${STORAGE_PREFIXES.CSV_TEMPLATE}/*`,
    ]));
  });

  it("skips bucket creation when it already exists but still applies the policy", async () => {
    minioInstance.bucketExists.mockResolvedValue(true as never);
    const storage = createStorage();

    await storage.ensureBucketExists();

    expect(minioInstance.makeBucket).not.toHaveBeenCalled();
    expect(minioInstance.setBucketPolicy).toHaveBeenCalled();
  });

  it("uploads, signs, and deletes profile photos using the single bucket with the caller-built key", async () => {
    const storage = createStorage();
    const body = Buffer.from("photo");
    const key = "profile-photos/student/user-1/avatar.png";

    await storage.uploadProfilePhoto({ key, body, contentType: "image/png", contentLength: body.length });
    const signedUrl = await storage.getProfilePhotoSignedUrl(key);
    await storage.deleteProfilePhoto(key);

    expect(minioInstance.putObject).toHaveBeenCalledWith("aspire-test", key, body, body.length, {
      "Content-Type": "image/png",
    });
    expect(minioInstance.presignedGetObject).toHaveBeenCalledWith("aspire-test", key, 300);
    expect(minioInstance.removeObject).toHaveBeenCalledWith("aspire-test", key);
    expect(signedUrl).toBe("https://signed.example.com/photo");
  });

  it("uploads invoice PDFs under the invoices/ prefix and returns the stored key", async () => {
    const storage = createStorage();
    const body = Buffer.from("%PDF");

    const key = await storage.uploadInvoicePdf({
      userId: "student-1",
      invoiceId: "in_123",
      body,
      contentLength: body.length,
    });
    const signedUrl = await storage.getInvoicePdfSignedUrl(key);

    expect(key).toBe("invoices/student-1/in_123.pdf");
    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "aspire-test",
      "invoices/student-1/in_123.pdf",
      body,
      body.length,
      { "Content-Type": "application/pdf" }
    );
    expect(minioInstance.presignedGetObject).toHaveBeenCalledWith("aspire-test", "invoices/student-1/in_123.pdf", 300);
    expect(signedUrl).toBe("https://signed.example.com/photo");
  });

  it("uploads CSV templates with caller-provided prefixed key and supports signed download URLs", async () => {
    const storage = createStorage();
    const body = Buffer.from("Header\nValue");
    const key = "csv-templates/question-mcq.csv";

    await storage.uploadCsvTemplate({
      key,
      body,
      contentType: "text/csv",
      contentLength: body.length,
      downloadFileName: "question-mcq-template.csv",
    });
    const info = await storage.getCsvTemplateObjectInfo(key);
    const signedUrl = await storage.getCsvTemplateSignedUrl(key);

    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "aspire-test",
      key,
      body,
      body.length,
      {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="question-mcq-template.csv"',
      }
    );
    expect(minioInstance.statObject).toHaveBeenCalledWith("aspire-test", key);
    expect(minioInstance.presignedGetObject).toHaveBeenCalledWith("aspire-test", key, 300);
    expect(info.size).toBe(42);
    expect(info.contentType).toBe("text/csv");
    expect(signedUrl).toBe("https://signed.example.com/photo");
  });

  it("uploads passage, question, and banner images with prefixed keys and public URLs", async () => {
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
      "aspire-test",
      "passages/passage-1/diagram.png",
      body,
      body.length,
      { "Content-Type": "image/png" }
    );
    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "aspire-test",
      "questions/question-1/1770000000000-diagram.png",
      body,
      body.length,
      { "Content-Type": "image/png" }
    );
    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "aspire-test",
      "banners/banner-1/1770000000000-hero.jpg",
      body,
      body.length,
      { "Content-Type": "image/jpeg" }
    );
    expect(passageUrl).toBe("https://s3.example.com/aspire-test/passages/passage-1/diagram.png");
    expect(questionUrl).toBe("https://s3.example.com/aspire-test/questions/question-1/1770000000000-diagram.png");
    expect(bannerUrl).toBe("https://s3.example.com/aspire-test/banners/banner-1/1770000000000-hero.jpg");
  });

  it("publishes object URLs from the public endpoint when configured", async () => {
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

    expect(bannerUrl).toBe("https://assets.example.com/aspire-test/banners/banner-1/1770000000001-hero.jpg");
  });

  it("uploads resource files under the resources/ prefix and returns a public URL", async () => {
    const storage = createStorage();
    const body = Buffer.from("PDF");

    const url = await storage.uploadResourceFile({
      resourceId: "res-1",
      filename: "guide.pdf",
      body,
      contentType: "application/pdf",
      contentLength: body.length,
    });

    expect(minioInstance.putObject).toHaveBeenCalledWith(
      "aspire-test",
      "resources/res-1/guide.pdf",
      body,
      body.length,
      { "Content-Type": "application/pdf" }
    );
    expect(url).toBe("https://s3.example.com/aspire-test/resources/res-1/guide.pdf");
  });

  it("deletes a generic object using only the key (single bucket)", async () => {
    const storage = createStorage();

    await storage.deleteObject("passages/refId/file.png");

    expect(minioInstance.removeObject).toHaveBeenCalledWith("aspire-test", "passages/refId/file.png");
  });
});
