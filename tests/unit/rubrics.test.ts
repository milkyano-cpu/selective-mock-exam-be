import { describe, expect, it, jest } from "@jest/globals";
import {
  createRubric,
  deactivateRubric,
  getRubricById,
  importRubrics,
  listRubrics,
  updateRubric,
} from "../../src/modules/rubrics/rubrics.service.js";
import * as rubricsController from "../../src/modules/rubrics/rubrics.controller.js";

const now = new Date("2026-05-08T00:00:00.000Z");

function rubric(overrides: Record<string, unknown> = {}) {
  return {
    id: "SELECTIVE_ENTRY_DEFAULT",
    name: "Selective Entry Writing Default",
    description: "Default rubric",
    writingType: "selective_entry",
    isDefault: true,
    isActive: true,
    totalMaxScore: 20,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function rubricDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...rubric(),
    criteria: [
      {
        id: "criterion-1",
        rubricId: "SELECTIVE_ENTRY_DEFAULT",
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
    rubric: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async () => rubric()),
      update: jest.fn(async () => rubric()),
      upsert: jest.fn(async () => rubric()),
    },
    rubricCriterion: {
      deleteMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async () => ({ id: "criterion-1" })),
    },
    rubricBandDescriptor: {
      createMany: jest.fn(async () => ({ count: 1 })),
    },
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const tx = createTx();
  return {
    tx,
    $transaction: jest.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)),
    rubric: {
      findMany: jest.fn(async () => [rubric()]),
      count: jest.fn(async () => 1),
      findUnique: jest.fn(async () => rubricDetail()),
      update: jest.fn(async () => rubric()),
    },
    ...overrides,
  };
}

function csvBuffer(rows: Array<Record<string, string>>) {
  const headers = [
    "RubricID",
    "RubricName",
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

describe("rubrics module", () => {
  it("lists rubrics with search and active filters", async () => {
    const prisma = mockPrisma();

    const result = await listRubrics(prisma as never, {
      page: 2,
      limit: 10,
      search: "writing",
      activeOnly: true,
    });

    expect(prisma.rubric.findMany).toHaveBeenCalledWith({
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

  it("throws 404 when a rubric is missing", async () => {
    const prisma = mockPrisma({
      rubric: {
        ...mockPrisma().rubric,
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(getRubricById(prisma as never, "missing-rubric")).rejects.toMatchObject({
      statusCode: 404,
      message: "Rubric not found",
    });
  });

  it("creates a default rubric and replaces criteria", async () => {
    const prisma = mockPrisma();

    const result = await createRubric(prisma as never, {
      id: "SELECTIVE_ENTRY_DEFAULT",
      name: "Selective Entry Writing Default",
      description: "Default rubric",
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

    expect(prisma.tx.rubric.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    expect(prisma.tx.rubric.create).toHaveBeenCalledWith({
      data: {
        id: "SELECTIVE_ENTRY_DEFAULT",
        name: "Selective Entry Writing Default",
        description: "Default rubric",
        writingType: "selective_entry",
        isDefault: true,
        isActive: true,
        totalMaxScore: 20,
      },
    });
    expect(prisma.tx.rubricCriterion.deleteMany).toHaveBeenCalledWith({
      where: { rubricId: "SELECTIVE_ENTRY_DEFAULT" },
    });
    expect(prisma.tx.rubricBandDescriptor.createMany).toHaveBeenCalled();
    expect(result).toEqual(rubricDetail());
  });

  it("updates a rubric and clears other default flags when needed", async () => {
    const prisma = mockPrisma();

    await updateRubric(prisma as never, "SELECTIVE_ENTRY_DEFAULT", {
      name: "Updated rubric",
      isDefault: true,
      criteria: [],
    });

    expect(prisma.tx.rubric.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true, id: { not: "SELECTIVE_ENTRY_DEFAULT" } },
      data: { isDefault: false },
    });
    expect(prisma.tx.rubric.update).toHaveBeenCalledWith({
      where: { id: "SELECTIVE_ENTRY_DEFAULT" },
      data: { name: "Updated rubric", isDefault: true },
    });
    expect(prisma.tx.rubricCriterion.deleteMany).toHaveBeenCalledWith({
      where: { rubricId: "SELECTIVE_ENTRY_DEFAULT" },
    });
  });

  it("deactivates a rubric and removes default status", async () => {
    const prisma = mockPrisma();

    await deactivateRubric(prisma as never, "SELECTIVE_ENTRY_DEFAULT");

    expect(prisma.rubric.update).toHaveBeenCalledWith({
      where: { id: "SELECTIVE_ENTRY_DEFAULT" },
      data: { isActive: false, isDefault: false },
    });
  });

  it("imports grouped rubric rows from CSV", async () => {
    const prisma = mockPrisma();
    const buffer = csvBuffer([
      {
        RubricID: "RUBRIC_A",
        RubricName: "Rubric A",
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
        RubricID: "RUBRIC_A",
        TotalMaxScore: "20",
        CriterionName: "Structure",
        CriterionDescription: "Logical structure",
        MaxScore: "10",
      },
    ]);

    const result = await importRubrics(prisma as never, buffer);

    expect(result).toEqual({ total: 2, imported: 1, failed: 0, errors: [] });
    expect(prisma.tx.rubric.upsert).toHaveBeenCalledWith({
      where: { id: "RUBRIC_A" },
      create: {
        id: "RUBRIC_A",
        name: "Rubric A",
        description: "Imported",
        writingType: "essay",
        isDefault: true,
        totalMaxScore: 20,
        isActive: true,
      },
      update: {
        name: "Rubric A",
        description: "Imported",
        writingType: "essay",
        isDefault: true,
        totalMaxScore: 20,
        isActive: true,
      },
    });
    expect(prisma.tx.rubricCriterion.create).toHaveBeenCalledTimes(2);
    expect(prisma.tx.rubricBandDescriptor.createMany).toHaveBeenCalledTimes(1);
  });

  it("returns row errors for invalid rubric CSV rows", async () => {
    const prisma = mockPrisma();
    const result = await importRubrics(
      prisma as never,
      csvBuffer([
        {
          RubricID: "",
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
    expect(result.errors[0]?.reason).toContain("RubricID is required");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized rubric CSV files", async () => {
    await expect(importRubrics(mockPrisma() as never, Buffer.from('"unterminated'))).rejects.toMatchObject({
      statusCode: 400,
      message: "Failed to parse CSV file. Ensure it is a valid Rubrics CSV.",
    });

    const rows = Array.from({ length: 501 }, (_, index) => ({
      RubricID: `R${index}`,
      TotalMaxScore: "1",
      CriterionName: "Criterion",
      CriterionDescription: "Description",
      MaxScore: "1",
    }));
    await expect(importRubrics(mockPrisma() as never, csvBuffer(rows))).rejects.toMatchObject({
      statusCode: 400,
      message: "CSV exceeds maximum of 500 rows",
    });
  });

  it("handles rubric controller responses", async () => {
    const request = mockRequest();
    const reply = mockReply();

    const listResponse = await rubricsController.listRubricsHandler(request as never, reply as never);
    const getResponse = await rubricsController.getRubricHandler(request as never, reply as never);
    const createResponse = await rubricsController.createRubricHandler(request as never, reply as never);
    const updateResponse = await rubricsController.updateRubricHandler(request as never, reply as never);
    const deactivateResponse = await rubricsController.deactivateRubricHandler(request as never, reply as never);

    expect(listResponse).toMatchObject({ success: true, message: "Rubrics retrieved" });
    expect(getResponse).toMatchObject({ success: true, message: "Rubric retrieved" });
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(createResponse).toMatchObject({ success: true, message: "Rubric created" });
    expect(updateResponse).toMatchObject({ success: true, message: "Rubric updated" });
    expect(deactivateResponse).toEqual({ success: true, message: "Rubric deactivated" });
  });

  it("handles rubric import controller file states", async () => {
    const missingFileReply = mockReply();
    const missingFileResponse = await rubricsController.importRubricsHandler(
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
              RubricID: "RUBRIC_A",
              TotalMaxScore: "1",
              CriterionName: "Criterion",
              CriterionDescription: "Description",
              MaxScore: "1",
            },
          ])
        ),
      })),
    });
    const response = await rubricsController.importRubricsHandler(fileRequest as never, mockReply() as never);

    expect(response).toMatchObject({
      success: true,
      message: "Rubrics import completed: 1 rubric(s) imported",
      data: { total: 1, imported: 1, failed: 0 },
    });
  });
});
