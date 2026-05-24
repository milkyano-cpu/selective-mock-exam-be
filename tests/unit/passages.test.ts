import { describe, expect, it, jest } from "@jest/globals";
import {
  createPassage,
  deletePassage,
  getPassageById,
  importPassages,
  listPassages,
  updatePassage,
} from "../../src/modules/passages/passages.service.js";
import * as passagesController from "../../src/modules/passages/passages.controller.js";

const now = new Date("2026-05-08T00:00:00.000Z");

function passage(overrides: Record<string, unknown> = {}) {
  return {
    id: "passage-1",
    passageId: "RC001",
    title: "Reading Passage",
    text: "A short reading passage.",
    imageRef: null,
    image: null,
    passageFormat: "text",
    passageType: "comprehension",
    imageDisplayPosition: null,
    subjectId: "subject-reading",
    subject: { id: "subject-reading", name: "Reading Comprehension" },
    difficulty: "MEDIUM",
    topicId: "topic-inference",
    topic: { id: "topic-inference", name: "Inference" },
    imageAltText: null,
    imageCaption: null,
    latexEnabled: false,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function passageDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...passage(),
    _count: { questions: 0 },
    questions: [],
    ...overrides,
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    passage: {
      findUnique: jest.fn(async () => passageDetail()),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: "passage-1" })),
      findMany: jest.fn(async () => [passage({ _count: { questions: 0 } })]),
      count: jest.fn(async () => 1),
      update: jest.fn(async () => passage()),
      delete: jest.fn(async () => passage()),
    },
    question: {
      count: jest.fn(async () => 0),
    },
    subject: {
      findUnique: jest.fn(async () => ({ name: "Reading Comprehension" })),
      findFirst: jest.fn(async () => ({ id: "subject-reading", name: "Reading Comprehension" })),
    },
    topic: {
      findFirst: jest.fn(async () => ({ id: "topic-inference" })),
    },
    image: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ uuid: "image-1" })),
      update: jest.fn(async () => ({ uuid: "image-1" })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => []),
    },
    ...overrides,
  };
}

function csvBuffer(rows: Array<Record<string, string>>) {
  const headers = [
    "PassageID",
    "PassageTitle",
    "PassageText",
    "PassageFormat",
    "PassageImageRef",
    "ImageAltText",
    "ImageCaption",
    "ImageDisplayPosition",
    "PassageType",
    "Section",
    "Difficulty",
    "Topic",
    "LatexEnabled",
    "Notes",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const value = row[header] ?? "";
          return value.includes(",") ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(",")
    ),
  ];
  return Buffer.from(lines.join("\n"));
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

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    query: { page: 1, limit: 20 },
    params: { id: "passage-1" },
    body: {
      title: "Reading Passage",
      text: "A short reading passage.",
      passageFormat: "text",
      passageType: "comprehension",
      subjectId: "subject-reading",
      topicId: "topic-inference",
      difficulty: "MEDIUM",
    },
    server: { prisma: mockPrisma() },
    log: { info: jest.fn() },
    file: jest.fn(),
    ...overrides,
  };
}

describe("passages module", () => {
  it("creates a passage with auto-generated passageId", async () => {
    const prisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => passageDetail()),
      },
    });

    const result = await createPassage(prisma as never, {
      title: "Reading Passage",
      text: "A short reading passage.",
      passageFormat: "text",
      passageType: "comprehension",
      subjectId: "subject-reading",
      topicId: "topic-inference",
      difficulty: "MEDIUM",
      latexEnabled: true,
    });

    expect(prisma.passage.create).toHaveBeenCalledWith({
      data: {
        passageId: "RC001",
        title: "Reading Passage",
        text: "A short reading passage.",
        imageRef: null,
        imageAltText: null,
        imageCaption: null,
        passageFormat: "text",
        passageType: "comprehension",
        imageDisplayPosition: null,
        subjectId: "subject-reading",
        topicId: "topic-inference",
        difficulty: "MEDIUM",
        latexEnabled: true,
        notes: null,
      },
      select: { id: true },
    });
    expect(result).toEqual(passageDetail());
  });

  it("auto-increments passageId based on existing rows", async () => {
    const prisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findMany: jest.fn(async () => [
          { passageId: "RC001" },
          { passageId: "RC005" },
          { passageId: "RC003" },
        ]),
        findUnique: jest.fn(async () => passageDetail()),
      },
    });

    await createPassage(prisma as never, {
      text: "Next passage",
      passageFormat: "text",
      passageType: "comprehension",
      subjectId: "subject-reading",
      topicId: "topic-inference",
      difficulty: "MEDIUM",
    });

    expect(prisma.passage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ passageId: "RC006" }),
      select: { id: true },
    });
  });

  it("lists passages with search and pagination", async () => {
    const prisma = mockPrisma();

    const result = await listPassages(prisma as never, { page: 2, limit: 10, search: "logic" });

    expect(prisma.passage.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { text: { contains: "logic", mode: "insensitive" } },
          { title: { contains: "logic", mode: "insensitive" } },
          { passageId: { contains: "logic", mode: "insensitive" } },
        ],
      },
      select: expect.any(Object),
      orderBy: { createdAt: "desc" },
      skip: 10,
      take: 10,
    });
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
  });

  it("throws 404 when a passage is missing", async () => {
    const prisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(getPassageById(prisma as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Passage not found",
    });
  });

  it("updates a passage without touching passageId", async () => {
    const prisma = mockPrisma();

    await updatePassage(prisma as never, "passage-1", {
      title: "Updated Passage",
      latexEnabled: true,
    });

    expect(prisma.passage.update).toHaveBeenCalledWith({
      where: { id: "passage-1" },
      data: {
        title: "Updated Passage",
        latexEnabled: true,
      },
    });
  });

  it("deletes passages only when there are no linked questions", async () => {
    const prisma = mockPrisma();

    await deletePassage(prisma as never, "passage-1");
    expect(prisma.passage.delete).toHaveBeenCalledWith({ where: { id: "passage-1" } });

    const linkedPrisma = mockPrisma({
      question: {
        count: jest.fn(async () => 3),
      },
    });

    await expect(deletePassage(linkedPrisma as never, "passage-1")).rejects.toMatchObject({
      statusCode: 409,
      message: "Cannot delete passage: it is linked to 3 question(s)",
    });
  });

  it("imports passages with auto-generated passageId, ignoring the CSV PassageID column", async () => {
    const prisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findMany: jest.fn(async () => []),
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: "created-passage" } as never)
          .mockResolvedValueOnce({ id: "image-passage" } as never)
          .mockRejectedValueOnce(new Error("db failed") as never),
      },
    });

    const result = await importPassages(
      prisma as never,
      csvBuffer([
        {
          PassageID: "LEGACY-001",
          PassageTitle: "Created",
          PassageText: "Text",
          PassageType: "text",
          Section: "Reading Comprehension",
          Topic: "Inference",
          Difficulty: "easy",
          LatexEnabled: "yes",
        },
        {
          PassageID: "LEGACY-002",
          PassageTitle: "Created with image",
          PassageImageRef: "images/passage.png",
          ImageAltText: "Passage alt",
          ImageCaption: "Passage caption",
          PassageType: "image",
          Section: "Reading Comprehension",
          Topic: "Inference",
          Difficulty: "hard",
        },
        {
          PassageID: "P003",
          PassageTitle: "Invalid",
          PassageType: "Video",
          Section: "Reading Comprehension",
          Topic: "Inference",
          Difficulty: "Impossible",
        },
        {
          PassageID: "P004",
          PassageTitle: "DB error",
          PassageText: "Text",
          Section: "Reading Comprehension",
          Topic: "Inference",
          Difficulty: "medium",
        },
      ])
    );

    expect(result).toEqual({
      total: 4,
      created: 2,
      updated: 0,
      failed: 2,
      errors: [
        {
          row: 4,
          reason:
            'PassageFormat is required or must be inferable from PassageText/PassageImageRef; PassageType "Video" must be comprehension, poem, or visual; PassageType is required or must be inferable from PassageFormat; Difficulty "Impossible" must be Easy, Medium, or Hard',
        },
        { row: 5, reason: "Database error while saving row" },
      ],
    });
    expect(prisma.passage.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        passageId: "RC001",
        text: "Text",
        passageFormat: "text",
        passageType: "comprehension",
        difficulty: "EASY",
        latexEnabled: true,
      }),
    });
    expect(prisma.passage.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        passageId: "RC002",
        imageRef: "images/passage.png",
        imageAltText: "Passage alt",
        imageCaption: "Passage caption",
        passageFormat: "image_only",
        passageType: "visual",
        difficulty: "HARD",
      }),
    });
    expect(prisma.image.create).toHaveBeenCalledWith({
      data: {
        fileName: "images/passage.png",
        altText: "Passage alt",
        caption: "Passage caption",
        expiredDate: null,
      },
    });
    expect(prisma.passage.update).not.toHaveBeenCalled();
  });

  it("resolves passage Section and Topic columns from CSV", async () => {
    const subjectFindFirst = jest.fn(async () => ({ id: "subject-reading", name: "Reading Comprehension" }));
    const topicFindFirst = jest.fn(async () => ({ id: "topic-main-idea" }));
    const prisma = mockPrisma({
      subject: {
        findFirst: subjectFindFirst,
      },
      topic: {
        findFirst: topicFindFirst,
      },
      passage: {
        ...mockPrisma().passage,
        findMany: jest.fn(async () => []),
        create: jest.fn(async () => ({ id: "created-passage" })),
      },
    });

    const result = await importPassages(
      prisma as never,
      csvBuffer([
        {
          PassageID: "RC001",
          PassageTitle: "Reading passage",
          PassageText: "Text",
          Section: "Reading Comprehension",
          Topic: "Main Idea",
          Difficulty: "medium",
        },
      ])
    );

    expect(result).toEqual({ total: 1, created: 1, updated: 0, failed: 0, errors: [] });
    expect(subjectFindFirst).toHaveBeenCalledWith({
      where: { name: { equals: "Reading Comprehension", mode: "insensitive" } },
      select: { id: true, name: true },
    });
    expect(topicFindFirst).toHaveBeenCalledWith({
      where: { name: { equals: "Main Idea", mode: "insensitive" }, subjectId: "subject-reading" },
      select: { id: true },
    });
    expect(prisma.passage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        passageFormat: "text",
        passageType: "comprehension",
        difficulty: "MEDIUM",
        subjectId: "subject-reading",
        topicId: "topic-main-idea",
      }),
    });
  });

  it("rejects malformed and oversized passage CSV files", async () => {
    await expect(importPassages(mockPrisma() as never, Buffer.from('"unterminated'))).rejects.toMatchObject({
      statusCode: 400,
      message: "Failed to parse CSV file. Ensure it is a valid CSV with the correct headers.",
    });

    const rows = Array.from({ length: 501 }, (_, index) => ({
      PassageID: `P${index}`,
      PassageText: "Text",
    }));
    await expect(importPassages(mockPrisma() as never, csvBuffer(rows))).rejects.toMatchObject({
      statusCode: 400,
      message: "CSV exceeds maximum of 500 rows",
    });
  });

  it("reports remaining required-field errors even without PassageID column", async () => {
    const prisma = mockPrisma();

    const result = await importPassages(
      prisma as never,
      csvBuffer([{ PassageTitle: "Ad hoc passage", PassageText: "Text without external id" }])
    );

    expect(result).toEqual({
      total: 1,
      created: 0,
      updated: 0,
      failed: 1,
      errors: [
        {
          row: 2,
          reason: "Difficulty is required; Section is required; Topic is required",
        },
      ],
    });
    expect(prisma.passage.create).not.toHaveBeenCalled();
  });

  it("handles passage controller CRUD responses", async () => {
    const prisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findUnique: jest.fn(async () => passageDetail()),
      },
    });
    const request = mockRequest({ server: { prisma } });
    const reply = mockReply();

    const createResponse = await passagesController.createPassageHandler(request as never, reply as never);
    const listResponse = await passagesController.listPassagesHandler(request as never, reply as never);
    const getResponse = await passagesController.getPassageByIdHandler(request as never, reply as never);
    const updateResponse = await passagesController.updatePassageHandler(request as never, reply as never);
    const deleteResponse = await passagesController.deletePassageHandler(request as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(201);
    expect(createResponse).toMatchObject({ success: true, message: "Passage created" });
    expect(listResponse).toMatchObject({ success: true, message: "Passages retrieved" });
    expect(getResponse).toMatchObject({ success: true, message: "Passage retrieved" });
    expect(updateResponse).toMatchObject({ success: true, message: "Passage updated" });
    expect(deleteResponse).toEqual({ success: true, message: "Passage deleted" });
  });

  it("handles passage import controller file validation and success", async () => {
    await expect(
      passagesController.importPassagesHandler(
        mockRequest({ file: jest.fn(async () => undefined) }) as never,
        mockReply() as never
      )
    ).rejects.toMatchObject({ statusCode: 400, message: "No file uploaded" });

    await expect(
      passagesController.importPassagesHandler(
        mockRequest({ file: jest.fn(async () => ({ filename: "passages.txt" })) }) as never,
        mockReply() as never
      )
    ).rejects.toMatchObject({ statusCode: 400, message: "Uploaded file must be a CSV" });

    const prisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findUnique: jest.fn(async () => null),
      },
    });
    const request = mockRequest({
      server: { prisma },
      file: jest.fn(async () => ({
        filename: "passages.csv",
        toBuffer: jest.fn(async () => csvBuffer([{
          PassageID: "P001",
          PassageText: "Text",
          Section: "Reading Comprehension",
          Topic: "Inference",
          Difficulty: "medium",
        }])),
      })),
    });
    const reply = mockReply();

    const response = await passagesController.importPassagesHandler(request as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(request.log.info).toHaveBeenCalledWith(
      { total: 1, created: 1, updated: 0, failed: 0 },
      "Passages import complete"
    );
    expect(response).toEqual({
      success: true,
      message: "Import complete: 1 created, 0 updated, 0 failed",
      data: { total: 1, created: 1, updated: 0, failed: 0, errors: [] },
    });
  });
});
