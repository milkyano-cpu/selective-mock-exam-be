import { describe, expect, it, jest } from "@jest/globals";
import {
  createAiRubric,
  deactivateAiRubric,
  getAiRubricById,
  importAiRubrics,
  listAiRubrics,
  updateAiRubric,
} from "../../src/modules/ai-rubrics/ai-rubrics.service.js";
import * as aiRubricsController from "../../src/modules/ai-rubrics/ai-rubrics.controller.js";

const now = new Date("2026-05-08T00:00:00.000Z");

function aiRubric(overrides: Record<string, unknown> = {}) {
  return {
    id: "SELECTIVE_ENTRY_DEFAULT",
    name: "Selective Entry Writing Default",
    description: "Default aiRubric",
    writingType: "selective_entry",
    isDefault: true,
    isActive: true,
    totalMaxScore: 20,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function aiRubricDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...aiRubric(),
    criteria: [
      {
        id: "criterion-1",
        aiRubricId: "SELECTIVE_ENTRY_DEFAULT",
        criterionName: "Ideas",
        criterionDescription: "Clear ideas",
        maxScore: 10,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        bandDescriptors: [
          {
            id: "band-1",
            criterionId: "criterion-1",
            scoreMin: 0,
            scoreMax: 10,
            descriptor: "Developed response",
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createTx() {
  return {
    aiRubric: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async () => aiRubric()),
      update: jest.fn(async () => aiRubric()),
      upsert: jest.fn(async () => aiRubric()),
    },
    aiRubricCriterion: {
      deleteMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async () => ({ id: "criterion-1" })),
    },
    aiRubricBandDescriptor: {
      createMany: jest.fn(async () => ({ count: 1 })),
    },
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const tx = createTx();
  return {
    tx,
    $transaction: jest.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)),
    aiRubric: {
      findMany: jest.fn(async () => [aiRubric()]),
      count: jest.fn(async () => 1),
      findUnique: jest.fn(async () => aiRubricDetail()),
      update: jest.fn(async () => aiRubric()),
    },
    ...overrides,
  };
}

function csvBuffer(rows: Array<Record<string, string>>) {
  const headers = [
    "AIRubricID",
    "AIRubricName",
    "Description",
    "WritingType",
    "IsDefault",
    "TotalMaxScore",
    "CriterionName",
    "CriterionDescription",
    "MaxScore",
    "BandDescriptors",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const value = row[header] ?? "";
          return value.includes(",") || value.includes("|") ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(",")
    ),
  ];
  return Buffer.from(lines.join("\n"));
}

function mockReply() {
  const reply = {
    code: jest.fn<(code: number) => typeof reply>(),
    status: jest.fn<(code: number) => typeof reply>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.code.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    query: { page: 1, limit: 20, activeOnly: true },
    params: { id: "SELECTIVE_ENTRY_DEFAULT" },
    body: {
      id: "SELECTIVE_ENTRY_DEFAULT",
      name: "Selective Entry Writing Default",
      totalMaxScore: 20,
      isDefault: true,
    },
    server: { prisma: mockPrisma() },
    file: jest.fn(),
    ...overrides,
  };
}

describe("aiRubrics module", () => {
  it("lists aiRubrics with search and active filters", async () => {
    const prisma = mockPrisma();

    const result = await listAiRubrics(prisma as never, {
      page: 2,
      limit: 10,
      search: "writing",
      activeOnly: true,
    });

    expect(prisma.aiRubric.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { id: { contains: "writing", mode: "insensitive" } },
          { name: { contains: "writing", mode: "insensitive" } },
          { writingType: { contains: "writing", mode: "insensitive" } },
        ],
      },
      select: expect.any(Object),
      orderBy: { createdAt: "desc" },
      skip: 10,
      take: 10,
    });
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
  });

  it("throws 404 when a aiRubric is missing", async () => {
    const prisma = mockPrisma({
      aiRubric: {
        ...mockPrisma().aiRubric,
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(getAiRubricById(prisma as never, "missing-aiRubric")).rejects.toMatchObject({
      statusCode: 404,
      message: "AiRubric not found",
    });
  });

  it("creates a default aiRubric and replaces criteria", async () => {
    const prisma = mockPrisma();

    const result = await createAiRubric(prisma as never, {
      id: "SELECTIVE_ENTRY_DEFAULT",
      name: "Selective Entry Writing Default",
      description: "Default aiRubric",
      writingType: "selective_entry",
      isDefault: true,
      isActive: true,
      totalMaxScore: 20,
      criteria: [
        {
          criterionName: "Ideas",
          criterionDescription: "Clear ideas",
          maxScore: 20,
          bandDescriptors: [{ scoreMin: 0, scoreMax: 20, descriptor: "Complete" }],
        },
      ],
    });

    expect(prisma.tx.aiRubric.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true, writingType: "selective_entry" },
      data: { isDefault: false },
    });
    expect(prisma.tx.aiRubric.create).toHaveBeenCalledWith({
      data: {
        id: "SELECTIVE_ENTRY_DEFAULT",
        name: "Selective Entry Writing Default",
        description: "Default aiRubric",
        writingType: "selective_entry",
        isDefault: true,
        isActive: true,
        totalMaxScore: 20,
      },
    });
    expect(prisma.tx.aiRubricCriterion.deleteMany).toHaveBeenCalledWith({
      where: { aiRubricId: "SELECTIVE_ENTRY_DEFAULT" },
    });
    expect(prisma.tx.aiRubricBandDescriptor.createMany).toHaveBeenCalled();
    expect(result).toEqual(aiRubricDetail());
  });

  it("updates a aiRubric and clears other default flags when needed", async () => {
    const prisma = mockPrisma();

    await updateAiRubric(prisma as never, "SELECTIVE_ENTRY_DEFAULT", {
      name: "Updated aiRubric",
      isDefault: true,
      criteria: [],
    });

    expect(prisma.tx.aiRubric.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true, id: { not: "SELECTIVE_ENTRY_DEFAULT" } },
      data: { isDefault: false },
    });
    expect(prisma.tx.aiRubric.update).toHaveBeenCalledWith({
      where: { id: "SELECTIVE_ENTRY_DEFAULT" },
      data: { name: "Updated aiRubric", isDefault: true },
    });
    expect(prisma.tx.aiRubricCriterion.deleteMany).toHaveBeenCalledWith({
      where: { aiRubricId: "SELECTIVE_ENTRY_DEFAULT" },
    });
  });

  it("deactivates a aiRubric and removes default status", async () => {
    const prisma = mockPrisma();

    await deactivateAiRubric(prisma as never, "SELECTIVE_ENTRY_DEFAULT");

    expect(prisma.aiRubric.update).toHaveBeenCalledWith({
      where: { id: "SELECTIVE_ENTRY_DEFAULT" },
      data: { isActive: false, isDefault: false },
    });
  });

  it("imports grouped aiRubric rows from CSV", async () => {
    const prisma = mockPrisma();
    const buffer = csvBuffer([
      {
        AIRubricID: "AI_RUBRIC_A",
        AIRubricName: "AiRubric A",
        Description: "Imported",
        WritingType: "essay",
        IsDefault: "yes",
        TotalMaxScore: "20",
        CriterionName: "Ideas",
        CriterionDescription: "Clear ideas",
        MaxScore: "10",
        BandDescriptors: "0-5:Developing|6-10:Strong",
      },
      {
        AIRubricID: "AI_RUBRIC_A",
        TotalMaxScore: "20",
        CriterionName: "Structure",
        CriterionDescription: "Logical structure",
        MaxScore: "10",
      },
    ]);

    const result = await importAiRubrics(prisma as never, buffer);

    expect(result).toEqual({ total: 2, imported: 1, failed: 0, errors: [] });
    expect(prisma.tx.aiRubric.upsert).toHaveBeenCalledWith({
      where: { id: "AI_RUBRIC_A" },
      create: {
        id: "AI_RUBRIC_A",
        name: "AiRubric A",
        description: "Imported",
        writingType: "essay",
        isDefault: true,
        totalMaxScore: 20,
        isActive: true,
      },
      update: {
        name: "AiRubric A",
        description: "Imported",
        writingType: "essay",
        isDefault: true,
        totalMaxScore: 20,
        isActive: true,
      },
    });
    expect(prisma.tx.aiRubricCriterion.create).toHaveBeenCalledTimes(2);
    expect(prisma.tx.aiRubricBandDescriptor.createMany).toHaveBeenCalledTimes(1);
  });

  it("returns row errors for invalid aiRubric CSV rows", async () => {
    const prisma = mockPrisma();
    const result = await importAiRubrics(
      prisma as never,
      csvBuffer([
        {
          AIRubricID: "",
          CriterionName: "",
          CriterionDescription: "",
          MaxScore: "0",
          TotalMaxScore: "bad",
          BandDescriptors: "wrong",
        },
      ])
    );

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({ row: 2 });
    expect(result.errors[0]?.reason).toContain("AIRubricID is required");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized aiRubric CSV files", async () => {
    await expect(importAiRubrics(mockPrisma() as never, Buffer.from('"unterminated'))).rejects.toMatchObject({
      statusCode: 400,
      message: "Failed to parse CSV file. Ensure it is a valid AI Rubrics CSV.",
    });

    const rows = Array.from({ length: 501 }, (_, index) => ({
      AIRubricID: `R${index}`,
      TotalMaxScore: "1",
      CriterionName: "Criterion",
      CriterionDescription: "Description",
      MaxScore: "1",
    }));
    await expect(importAiRubrics(mockPrisma() as never, csvBuffer(rows))).rejects.toMatchObject({
      statusCode: 400,
      message: "CSV exceeds maximum of 500 rows",
    });
  });

  it("handles aiRubric controller responses", async () => {
    const request = mockRequest();
    const reply = mockReply();

    const listResponse = await aiRubricsController.listAiRubricsHandler(request as never, reply as never);
    const getResponse = await aiRubricsController.getAiRubricHandler(request as never, reply as never);
    const createResponse = await aiRubricsController.createAiRubricHandler(request as never, reply as never);
    const updateResponse = await aiRubricsController.updateAiRubricHandler(request as never, reply as never);
    const deactivateResponse = await aiRubricsController.deactivateAiRubricHandler(request as never, reply as never);

    expect(listResponse).toMatchObject({ success: true, message: "AI Rubrics retrieved" });
    expect(getResponse).toMatchObject({ success: true, message: "AiRubric retrieved" });
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(createResponse).toMatchObject({ success: true, message: "AiRubric created" });
    expect(updateResponse).toMatchObject({ success: true, message: "AiRubric updated" });
    expect(deactivateResponse).toEqual({ success: true, message: "AiRubric deactivated" });
  });

  it("handles aiRubric import controller file states", async () => {
    const missingFileReply = mockReply();
    const missingFileResponse = await aiRubricsController.importAiRubricsHandler(
      mockRequest({ file: jest.fn(async () => undefined) }) as never,
      missingFileReply as never
    );

    expect(missingFileReply.status).toHaveBeenCalledWith(400);
    expect(missingFileResponse).toEqual({ success: false, message: "CSV file is required" });

    const fileRequest = mockRequest({
      file: jest.fn(async () => ({
        toBuffer: jest.fn(async () =>
          csvBuffer([
            {
              AIRubricID: "AI_RUBRIC_A",
              TotalMaxScore: "1",
              CriterionName: "Criterion",
              CriterionDescription: "Description",
              MaxScore: "1",
            },
          ])
        ),
      })),
    });
    const response = await aiRubricsController.importAiRubricsHandler(fileRequest as never, mockReply() as never);

    expect(response).toMatchObject({
      success: true,
      message: "AI Rubrics import completed: 1 aiRubric(s) imported",
      data: { total: 1, imported: 1, failed: 0 },
    });
  });
});
