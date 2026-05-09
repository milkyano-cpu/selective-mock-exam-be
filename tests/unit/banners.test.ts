import { describe, expect, it, jest } from "@jest/globals";
import {
  createBannerRecord,
  deleteBannerRecord,
  findActiveBanners,
  findAllBanners,
  updateBannerRecord,
} from "../../src/modules/banners/banners.service.js";
import * as bannersController from "../../src/modules/banners/banners.controller.js";

function banner(overrides: Record<string, unknown> = {}) {
  return {
    id: "banner-1",
    imageUrl: "https://cdn.example.com/banner.webp",
    targetUrl: "https://example.com",
    isActive: true,
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    ...overrides,
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    banner: {
      findMany: jest.fn(async () => [banner()]),
      count: jest.fn(async () => 1),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => banner(args.data)),
      findUnique: jest.fn(async () => banner()),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => banner(args.data)),
      delete: jest.fn(async () => banner()),
    },
    ...overrides,
  };
}

function mockReply() {
  const reply = {
    status: jest.fn<(code: number) => typeof reply>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.status.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    query: { page: 1, limit: 20 },
    params: { id: "banner-1" },
    body: {},
    user: { sub: "admin-1" },
    server: {
      prisma: mockPrisma(),
      storage: {
        uploadBannerImage: jest.fn(async () => "https://cdn.example.com/uploaded.webp"),
      },
    },
    log: { info: jest.fn() },
    file: jest.fn(),
    ...overrides,
  };
}

describe("banners module", () => {
  it("finds active banners in display order", async () => {
    const prisma = mockPrisma();

    await findActiveBanners(prisma as never);

    expect(prisma.banner.findMany).toHaveBeenCalledWith({
      where: { isActive: true, imageUrl: { not: "" } },
      select: expect.any(Object),
      orderBy: { createdAt: "asc" },
    });
  });

  it("lists all banners with pagination metadata", async () => {
    const prisma = mockPrisma();

    const result = await findAllBanners(prisma as never, { page: 2, limit: 10 });

    expect(prisma.banner.findMany).toHaveBeenCalledWith({
      select: expect.any(Object),
      orderBy: { createdAt: "desc" },
      skip: 10,
      take: 10,
    });
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
  });

  it("creates a banner with empty image and null target defaults", async () => {
    const prisma = mockPrisma();

    await createBannerRecord(prisma as never, {
      imageUrl: null,
      targetUrl: "",
      isActive: true,
    });

    expect(prisma.banner.create).toHaveBeenCalledWith({
      data: {
        imageUrl: "",
        targetUrl: null,
        isActive: true,
      },
      select: expect.any(Object),
    });
  });

  it("updates only provided banner fields", async () => {
    const prisma = mockPrisma();

    await updateBannerRecord(prisma as never, "banner-1", {
      targetUrl: "",
      isActive: false,
    });

    expect(prisma.banner.update).toHaveBeenCalledWith({
      where: { id: "banner-1" },
      data: {
        targetUrl: null,
        isActive: false,
      },
      select: expect.any(Object),
    });
  });

  it("throws 404 when updating a missing banner", async () => {
    const prisma = mockPrisma({
      banner: {
        ...mockPrisma().banner,
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(
      updateBannerRecord(prisma as never, "missing-banner", { isActive: false })
    ).rejects.toMatchObject({ statusCode: 404, message: "Banner not found" });
  });

  it("deletes an existing banner", async () => {
    const prisma = mockPrisma();

    await deleteBannerRecord(prisma as never, "banner-1");

    expect(prisma.banner.delete).toHaveBeenCalledWith({ where: { id: "banner-1" } });
  });

  it("throws 404 when deleting a missing banner", async () => {
    const prisma = mockPrisma({
      banner: {
        ...mockPrisma().banner,
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(deleteBannerRecord(prisma as never, "missing-banner")).rejects.toMatchObject({
      statusCode: 404,
      message: "Banner not found",
    });
  });

  it("sends active banner response from the controller", async () => {
    const request = mockRequest();
    const reply = mockReply();

    const response = await bannersController.getActiveBannersHandler(request as never, reply as never);

    expect(response).toMatchObject({
      success: true,
      message: "Active banners retrieved successfully",
      data: [expect.objectContaining({ id: "banner-1" })],
    });
  });

  it("sends paginated banner response from the controller", async () => {
    const request = mockRequest({ query: { page: 2, limit: 10 } });
    const reply = mockReply();

    const response = await bannersController.listBannersHandler(request as never, reply as never);

    expect(request.server.prisma.banner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
    expect(response).toMatchObject({
      success: true,
      message: "Banners retrieved successfully",
      meta: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it("creates a banner from the controller with 201", async () => {
    const request = mockRequest({ body: { imageUrl: "https://cdn.example.com/banner.webp", isActive: true } });
    const reply = mockReply();

    const response = await bannersController.createBannerHandler(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(201);
    expect(response).toMatchObject({
      success: true,
      message: "Banner created successfully",
    });
  });

  it("updates and deletes banners from the controller", async () => {
    const updateRequest = mockRequest({ body: { isActive: false } });
    const deleteRequest = mockRequest();
    const reply = mockReply();

    await bannersController.updateBannerHandler(updateRequest as never, reply as never);
    const deleteResponse = await bannersController.deleteBannerHandler(deleteRequest as never, reply as never);

    expect(updateRequest.server.prisma.banner.update).toHaveBeenCalled();
    expect(deleteResponse).toEqual({
      success: true,
      message: "Banner deleted successfully",
    });
  });

  it("rejects banner image upload when no file is provided", async () => {
    const request = mockRequest({ file: jest.fn(async () => undefined) });

    await expect(
      bannersController.uploadBannerImageHandler(request as never, mockReply() as never)
    ).rejects.toMatchObject({ statusCode: 400, message: "No file uploaded" });
  });

  it("rejects banner image upload with unsupported mimetype", async () => {
    const request = mockRequest({
      file: jest.fn(async () => ({
        filename: "banner.txt",
        mimetype: "text/plain",
      })),
    });

    await expect(
      bannersController.uploadBannerImageHandler(request as never, mockReply() as never)
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Only JPEG, PNG, WebP, and GIF images are allowed",
    });
  });

  it("uploads a banner image, updates the banner URL, and logs the upload", async () => {
    const request = mockRequest({
      file: jest.fn(async () => ({
        filename: "hero.webp",
        mimetype: "image/webp",
        toBuffer: jest.fn(async () => Buffer.from("image-bytes")),
      })),
    });
    const reply = mockReply();

    const response = await bannersController.uploadBannerImageHandler(request as never, reply as never);

    expect(request.server.storage.uploadBannerImage).toHaveBeenCalledWith({
      bannerId: "banner-1",
      filename: expect.stringMatching(/^banner-\d+\.webp$/),
      body: Buffer.from("image-bytes"),
      contentType: "image/webp",
      contentLength: Buffer.from("image-bytes").length,
    });
    expect(request.server.prisma.banner.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { imageUrl: "https://cdn.example.com/uploaded.webp" },
      })
    );
    expect(request.log.info).toHaveBeenCalledWith(
      {
        bannerId: "banner-1",
        uploadedBy: "admin-1",
        imageUrl: "https://cdn.example.com/uploaded.webp",
      },
      "Banner image uploaded"
    );
    expect(response).toMatchObject({ success: true, message: "Image uploaded successfully" });
  });
});
