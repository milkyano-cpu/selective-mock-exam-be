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
    externalId: "P001",
    title: "Reading Passage",
    content: "A short reading passage.",
    imageUrl: null,
    passageType: "TEXT",
    section: "Reading",
    difficulty: "MEDIUM",
    topic: "Inference",
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
    ...overrides,
  };
}

function csvBuffer(rows: Array<Record<string, string>>) {
  const headers = [
    "PassageID",
    "PassageTitle",
    "PassageText",
    "PassageImageURL",
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
      externalId: "P001",
      title: "Reading Passage",
      content: "A short reading passage.",
      passageType: "TEXT",
    },
    server: { prisma: mockPrisma() },
    log: { info: jest.fn() },
    file: jest.fn(),
    ...overrides,
  };
}

describe("passages module", () => {
  it("creates a passage and returns its detail", async () => {
    const prisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null as never)
          .mockResolvedValueOnce(passageDetail() as never),
      },
    });

    const result = await createPassage(prisma as never, {
      externalId: "P001",
      title: "Reading Passage",
      content: "A short reading passage.",
      passageType: "TEXT",
      latexEnabled: true,
    });

    expect(prisma.passage.create).toHaveBeenCalledWith({
      data: {
        externalId: "P001",
        title: "Reading Passage",
        content: "A short reading passage.",
        imageUrl: null,
        passageType: "TEXT",
        section: null,
        difficulty: null,
        topic: null,
        latexEnabled: true,
        notes: null,
      },
      select: { id: true },
    });
    expect(result).toEqual(passageDetail());
  });

  it("rejects duplicate external ids on create", async () => {
    await expect(
      createPassage(mockPrisma() as never, {
        externalId: "P001",
        content: "Duplicate passage",
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Passage with externalId "P001" already exists',
    });
  });

  it("lists passages with search and pagination", async () => {
    const prisma = mockPrisma();

    const result = await listPassages(prisma as never, { page: 2, limit: 10, search: "logic" });

    expect(prisma.passage.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { content: { contains: "logic", mode: "insensitive" } },
          { title: { contains: "logic", mode: "insensitive" } },
          { externalId: { contains: "logic", mode: "insensitive" } },
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

  it("updates a passage and rejects conflicting external ids", async () => {
    const prisma = mockPrisma();

    await updatePassage(prisma as never, "passage-1", {
      externalId: "P002",
      title: "Updated Passage",
      latexEnabled: true,
    });

    expect(prisma.passage.findFirst).toHaveBeenCalledWith({
      where: { externalId: "P002", NOT: { id: "passage-1" } },
      select: { id: true },
    });
    expect(prisma.passage.update).toHaveBeenCalledWith({
      where: { id: "passage-1" },
      data: {
        externalId: "P002",
        title: "Updated Passage",
        latexEnabled: true,
      },
    });

    const conflictPrisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findFirst: jest.fn(async () => ({ id: "other-passage" })),
      },
    });

    await expect(
      updatePassage(conflictPrisma as never, "passage-1", { externalId: "P002" })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Another passage with externalId "P002" already exists',
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

  it("imports passages by creating, updating, and reporting row failures", async () => {
    const prisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null as never)
          .mockResolvedValueOnce({ id: "existing-passage" } as never)
          .mockResolvedValueOnce(null as never),
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: "created-passage" } as never)
          .mockRejectedValueOnce(new Error("db failed") as never),
        update: jest.fn(async () => passage()),
      },
    });

    const result = await importPassages(
      prisma as never,
      csvBuffer([
        {
          PassageID: "P001",
          PassageTitle: "Created",
          PassageText: "Text",
          PassageType: "text",
          Difficulty: "easy",
          LatexEnabled: "yes",
        },
        {
          PassageID: "P002",
          PassageTitle: "Updated",
          PassageImageURL: "https://cdn.example.com/passage.png",
          PassageType: "text+image",
          Difficulty: "hard",
        },
        {
          PassageID: "P003",
          PassageTitle: "Invalid",
          PassageType: "Video",
          Difficulty: "Impossible",
        },
        {
          PassageID: "P004",
          PassageTitle: "DB error",
          PassageText: "Text",
        },
      ])
    );

    expect(result).toEqual({
      total: 4,
      created: 1,
      updated: 1,
      failed: 2,
      errors: [
        {
          row: 4,
          reason:
            'At least one of PassageText or PassageImageURL is required; PassageType "Video" must be Text, Image, or Text+Image; Difficulty "Impossible" must be Easy, Medium, or Hard',
        },
        { row: 5, reason: "Database error while saving row" },
      ],
    });
    expect(prisma.passage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: "P001",
        passageType: "TEXT",
        difficulty: "EASY",
        latexEnabled: true,
      }),
    });
    expect(prisma.passage.update).toHaveBeenCalledWith({
      where: { externalId: "P002" },
      data: expect.objectContaining({
        passageType: "TEXT_IMAGE",
        difficulty: "HARD",
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

  it("imports passages without external ids as new rows", async () => {
    const prisma = mockPrisma();

    const result = await importPassages(
      prisma as never,
      csvBuffer([{ PassageTitle: "Ad hoc passage", PassageText: "Text without external id" }])
    );

    expect(result).toEqual({ total: 1, created: 1, updated: 0, failed: 0, errors: [] });
    expect(prisma.passage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Ad hoc passage",
        content: "Text without external id",
      }),
    });
  });

  it("handles passage controller CRUD responses", async () => {
    const prisma = mockPrisma({
      passage: {
        ...mockPrisma().passage,
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null as never)
          .mockResolvedValue(passageDetail() as never),
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
        toBuffer: jest.fn(async () => csvBuffer([{ PassageID: "P001", PassageText: "Text" }])),
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
