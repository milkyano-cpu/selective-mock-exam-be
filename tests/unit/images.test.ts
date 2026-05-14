import { describe, expect, it, jest } from "@jest/globals";
import {
  deleteImage,
  normalizeImageFileName,
  purgeExpiredImages,
  upsertImageMetadata,
} from "../../src/modules/images/images.service.js";
import { createImageHandler } from "../../src/modules/images/images.controller.js";

type AnyRecord = Record<string, any>;

function mockStorage(overrides: AnyRecord = {}) {
  return {
    deleteImageObject: jest.fn(async () => undefined),
    uploadImage: jest.fn(async () => "https://assets.example.com/images/image-1/123-diagram.png"),
    ...overrides,
  };
}

function imageRecord(overrides: AnyRecord = {}) {
  const now = new Date("2026-05-14T00:00:00.000Z");
  return {
    uuid: "image-1",
    fileName: "diagram.png",
    altText: "Diagram alt",
    caption: "Diagram caption",
    url: null,
    expiredDate: now,
    createdAt: now,
    updatedAt: now,
    _count: { passages: 0, questions: 0 },
    ...overrides,
  };
}

function mockReply() {
  const reply = {
    code: jest.fn<(code: number) => typeof reply>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.code.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

describe("images service", () => {
  it("normalizes image file names to basename only", () => {
    expect(normalizeImageFileName("images/foo.png")).toBe("foo.png");
    expect(normalizeImageFileName("images\\nested\\foo.png?version=1")).toBe("foo.png");
    expect(normalizeImageFileName("  ")).toBe("");
  });

  it("upserts metadata by file name and fills only blank existing fields", async () => {
    const prisma = {
      image: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null as never)
          .mockResolvedValueOnce({
            uuid: "image-1",
            altText: null,
            caption: "Existing caption",
          } as never),
        create: jest.fn(async () => ({ uuid: "image-1" })),
        update: jest.fn(async () => ({ uuid: "image-1" })),
      },
    };

    await upsertImageMetadata(prisma as never, {
      fileName: "images/diagram.png",
      altText: "A diagram",
      caption: "Diagram caption",
      linked: false,
    });
    await upsertImageMetadata(prisma as never, {
      fileName: "diagram.png",
      altText: "Filled alt",
      caption: "Replacement caption",
      linked: true,
    });

    expect(prisma.image.create).toHaveBeenCalledWith({
      data: {
        fileName: "diagram.png",
        altText: "A diagram",
        caption: "Diagram caption",
        expiredDate: expect.any(Date),
      },
    });
    expect(prisma.image.update).toHaveBeenCalledWith({
      where: { uuid: "image-1" },
      data: {
        expiredDate: null,
        altText: "Filled alt",
      },
    });
  });

  it("blocks deletion while an image is linked", async () => {
    const prisma = {
      image: {
        findUnique: jest.fn(async () => ({
          uuid: "image-1",
          url: "https://assets.example.com/images/image-1/123-diagram.png",
          _count: { passages: 1, questions: 0 },
        })),
        delete: jest.fn(),
      },
    };
    const storage = mockStorage();

    await expect(deleteImage(prisma as never, storage as never, "image-1")).rejects.toMatchObject({
      statusCode: 409,
      message: "Cannot delete image while it is linked to passages or questions",
    });
    expect(storage.deleteImageObject).not.toHaveBeenCalled();
    expect(prisma.image.delete).not.toHaveBeenCalled();
  });

  it("deletes unlinked image records and their MinIO object", async () => {
    const prisma = {
      image: {
        findUnique: jest.fn(async () => ({
          uuid: "image-1",
          url: "https://assets.example.com/images/image-1/123-diagram.png",
          _count: { passages: 0, questions: 0 },
        })),
        delete: jest.fn(async () => ({})),
      },
    };
    const storage = mockStorage();

    await deleteImage(prisma as never, storage as never, "image-1");

    expect(storage.deleteImageObject).toHaveBeenCalledWith("image-1/123-diagram.png");
    expect(prisma.image.delete).toHaveBeenCalledWith({ where: { uuid: "image-1" } });
  });

  it("purges only expired unlinked images selected by the cleanup query", async () => {
    const now = new Date("2026-05-08T00:00:00.000Z");
    const prisma = {
      image: {
        findMany: jest.fn(async () => [
          { uuid: "image-1", url: "https://assets.example.com/images/image-1/123-diagram.png" },
          { uuid: "image-2", url: null },
        ]),
        delete: jest.fn(async () => ({})),
      },
    };
    const storage = mockStorage();

    const deleted = await purgeExpiredImages(prisma as never, storage as never, now);

    expect(prisma.image.findMany).toHaveBeenCalledWith({
      where: {
        expiredDate: { lte: now },
        passages: { none: {} },
        questions: { none: {} },
      },
      select: { uuid: true, url: true },
    });
    expect(storage.deleteImageObject).toHaveBeenCalledWith("image-1/123-diagram.png");
    expect(prisma.image.delete).toHaveBeenCalledTimes(2);
    expect(deleted).toBe(2);
  });
});

describe("images controller", () => {
  it("stores multipart metadata even when fields are parsed after the file stream", async () => {
    const fields: AnyRecord = {};
    const uploaded = imageRecord({
      fileName: "custom.png",
      altText: "Custom alt",
      caption: "Custom caption",
      url: "https://assets.example.com/images/image-1/123-custom.png",
    });
    const prisma = {
      image: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => imageRecord({
          fileName: "custom.png",
          altText: "Custom alt",
          caption: "Custom caption",
        })),
        update: jest.fn(async () => uploaded),
      },
      passage: { count: jest.fn(async () => 0) },
      question: { count: jest.fn(async () => 0) },
    };
    const storage = mockStorage({
      uploadImage: jest.fn(async () => uploaded.url),
    });
    const request = {
      file: jest.fn(async () => ({
        filename: "diagram.png",
        mimetype: "image/png",
        fields,
        toBuffer: jest.fn(async () => {
          fields.fileName = { value: "custom.png" };
          fields.altText = { value: "Custom alt" };
          fields.caption = { value: "Custom caption" };
          return Buffer.from("image");
        }),
      })),
      server: { prisma, storage },
      user: { sub: "user-1" },
      log: { info: jest.fn() },
    };
    const reply = mockReply();

    const response = await createImageHandler(request as never, reply as never);

    expect(prisma.image.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fileName: "custom.png",
        altText: "Custom alt",
        caption: "Custom caption",
      }),
      select: expect.any(Object),
    });
    expect(storage.uploadImage).toHaveBeenCalledWith(expect.objectContaining({
      filename: "custom.png",
    }));
    expect(response).toMatchObject({
      success: true,
      data: {
        fileName: "custom.png",
        altText: "Custom alt",
        caption: "Custom caption",
      },
    });
  });
});
