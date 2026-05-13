import { Prisma, type PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { createHttpError } from "../../utils/http-error.js";
import type { CreateAiRubricBody, ListAiRubricsQuery, UpdateAiRubricBody } from "./ai-rubrics.schema.js";

type AiRubricCsvRow = {
  AIRubricID?: string;
  AIRubricName?: string;
  Description?: string;
  WritingType?: string;
  IsDefault?: string;
  TotalMaxScore?: string;
  CriterionName?: string;
  CriterionDescription?: string;
  MaxScore?: string;
  BandDescriptors?: string;
};

const AI_RUBRIC_SELECT = {
  id: true,
  name: true,
  description: true,
  writingType: true,
  isDefault: true,
  isActive: true,
  totalMaxScore: true,
  createdAt: true,
  updatedAt: true,
} as const;

const AI_RUBRIC_DETAIL_SELECT = {
  ...AI_RUBRIC_SELECT,
  criteria: {
    select: {
      id: true,
      aiRubricId: true,
      criterionName: true,
      criterionDescription: true,
      maxScore: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      bandDescriptors: {
        select: {
          id: true,
          criterionId: true,
          scoreMin: true,
          scoreMax: true,
          descriptor: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ scoreMin: "asc" }, { scoreMax: "asc" }],
      },
    },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.AiRubricSelect;

function parseBoolean(value: string | undefined) {
  return ["true", "1", "yes", "y"].includes((value ?? "").trim().toLowerCase());
}

function parseBandDescriptors(value: string | undefined) {
  if (!value?.trim()) return [];

  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [rangeRaw, ...descriptorParts] = item.split(":");
      const range = rangeRaw?.trim();
      const descriptor = descriptorParts.join(":").trim();
      if (!range || !descriptor) throw new Error(`Invalid band descriptor "${item}"`);

      const [minRaw, maxRaw] = range.split("-").map((part) => part.trim());
      const scoreMin = parseInt(minRaw ?? "", 10);
      const scoreMax = parseInt(maxRaw ?? minRaw ?? "", 10);
      if (!Number.isFinite(scoreMin) || !Number.isFinite(scoreMax) || scoreMin < 0 || scoreMax < scoreMin) {
        throw new Error(`Invalid score range "${range}"`);
      }

      return { scoreMin, scoreMax, descriptor };
    });
}

async function replaceAiRubricCriteria(
  tx: Prisma.TransactionClient,
  aiRubricId: string,
  criteria: NonNullable<CreateAiRubricBody["criteria"] | UpdateAiRubricBody["criteria"]>,
) {
  await tx.aiRubricCriterion.deleteMany({ where: { aiRubricId } });

  for (const [index, criterion] of criteria.entries()) {
    const createdCriterion = await tx.aiRubricCriterion.create({
      data: {
        aiRubricId,
        criterionName: criterion.criterionName,
        criterionDescription: criterion.criterionDescription,
        maxScore: criterion.maxScore,
        sortOrder: criterion.sortOrder ?? index,
      },
      select: { id: true },
    });

    const bandDescriptors = criterion.bandDescriptors ?? [];
    if (bandDescriptors.length > 0) {
      await tx.aiRubricBandDescriptor.createMany({
        data: bandDescriptors.map((descriptor) => ({
          criterionId: createdCriterion.id,
          scoreMin: descriptor.scoreMin,
          scoreMax: descriptor.scoreMax,
          descriptor: descriptor.descriptor,
        })),
      });
    }
  }
}

export async function listAiRubrics(prisma: PrismaClient, query: ListAiRubricsQuery) {
  const { page, limit, search, activeOnly } = query;
  const skip = (page - 1) * limit;

  const where = {
    ...(activeOnly ? { isActive: true } : {}),
    ...(search
      ? {
          OR: [
            { id: { contains: search, mode: "insensitive" as const } },
            { name: { contains: search, mode: "insensitive" as const } },
            { writingType: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.aiRubric.findMany({ where, select: AI_RUBRIC_SELECT, orderBy: { createdAt: "desc" }, skip, take: limit }),
    prisma.aiRubric.count({ where }),
  ]);

  return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getAiRubricById(prisma: PrismaClient, id: string) {
  const aiRubric = await prisma.aiRubric.findUnique({ where: { id }, select: AI_RUBRIC_DETAIL_SELECT });
  if (!aiRubric) throw createHttpError(404, "AiRubric not found");
  return aiRubric;
}

export async function createAiRubric(prisma: PrismaClient, body: CreateAiRubricBody) {
  await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      await tx.aiRubric.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    await tx.aiRubric.create({
      data: {
        id: body.id,
        name: body.name,
        description: body.description ?? null,
        writingType: body.writingType ?? null,
        isDefault: body.isDefault ?? false,
        isActive: body.isActive ?? true,
        totalMaxScore: body.totalMaxScore,
      },
    });

    if (body.criteria !== undefined) {
      await replaceAiRubricCriteria(tx, body.id, body.criteria);
    }
  });

  return getAiRubricById(prisma, body.id);
}

export async function updateAiRubric(prisma: PrismaClient, id: string, body: UpdateAiRubricBody) {
  await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      await tx.aiRubric.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    }

    await tx.aiRubric.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.writingType !== undefined ? { writingType: body.writingType } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.totalMaxScore !== undefined ? { totalMaxScore: body.totalMaxScore } : {}),
      },
    });

    if (body.criteria !== undefined) {
      await replaceAiRubricCriteria(tx, id, body.criteria);
    }
  });

  return getAiRubricById(prisma, id);
}

export async function deactivateAiRubric(prisma: PrismaClient, id: string) {
  await prisma.aiRubric.update({ where: { id }, data: { isActive: false, isDefault: false } });
}

export async function importAiRubrics(prisma: PrismaClient, buffer: Buffer) {
  let rows: AiRubricCsvRow[];
  try {
    rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as AiRubricCsvRow[];
  } catch {
    throw createHttpError(400, "Failed to parse CSV file. Ensure it is a valid AI Rubrics CSV.");
  }

  if (rows.length > 500) {
    throw createHttpError(400, "CSV exceeds maximum of 500 rows");
  }

  const errors: Array<{ row: number; reason: string }> = [];
  const grouped = new Map<string, { meta: { name: string; description: string | null; writingType: string | null; isDefault: boolean; totalMaxScore: number }; criteria: Array<{ criterionName: string; criterionDescription: string; maxScore: number; bandDescriptors: ReturnType<typeof parseBandDescriptors> }> }>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const aiRubricId = row.AIRubricID?.trim() ?? "";
    const criterionName = row.CriterionName?.trim() ?? "";
    const criterionDescription = row.CriterionDescription?.trim() ?? "";
    const maxScoreRaw = row.MaxScore?.trim() ?? "";
    const maxScore = parseInt(maxScoreRaw, 10);
    const totalMaxScoreRaw = row.TotalMaxScore?.trim();
    const totalMaxScore = totalMaxScoreRaw ? parseInt(totalMaxScoreRaw, 10) : 20;

    const rowErrors: string[] = [];
    if (!aiRubricId) rowErrors.push("AIRubricID is required");
    if (!criterionName) rowErrors.push("CriterionName is required");
    if (!criterionDescription) rowErrors.push("CriterionDescription is required");
    if (!Number.isFinite(maxScore) || maxScore < 1) rowErrors.push(`MaxScore "${maxScoreRaw}" must be a positive integer`);
    if (!Number.isFinite(totalMaxScore) || totalMaxScore < 1) rowErrors.push(`TotalMaxScore "${totalMaxScoreRaw ?? ""}" must be a positive integer`);

    let bandDescriptors: ReturnType<typeof parseBandDescriptors> = [];
    try {
      bandDescriptors = parseBandDescriptors(row.BandDescriptors);
    } catch (error) {
      rowErrors.push(error instanceof Error ? error.message : "Invalid BandDescriptors");
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      return;
    }

    if (!grouped.has(aiRubricId)) {
      grouped.set(aiRubricId, {
        meta: {
          name: row.AIRubricName?.trim() || aiRubricId,
          description: row.Description?.trim() || null,
          writingType: row.WritingType?.trim() || null,
          isDefault: parseBoolean(row.IsDefault),
          totalMaxScore,
        },
        criteria: [],
      });
    }

    grouped.get(aiRubricId)!.criteria.push({ criterionName, criterionDescription, maxScore, bandDescriptors });
  });

  let imported = 0;
  for (const [aiRubricId, data] of grouped.entries()) {
    await prisma.$transaction(async (tx) => {
      if (data.meta.isDefault) {
        await tx.aiRubric.updateMany({ where: { isDefault: true, id: { not: aiRubricId } }, data: { isDefault: false } });
      }

      await tx.aiRubric.upsert({
        where: { id: aiRubricId },
        create: { id: aiRubricId, ...data.meta, isActive: true },
        update: { ...data.meta, isActive: true },
      });

      await tx.aiRubricCriterion.deleteMany({ where: { aiRubricId } });

      for (const [index, criterion] of data.criteria.entries()) {
        const createdCriterion = await tx.aiRubricCriterion.create({
          data: {
            aiRubricId,
            criterionName: criterion.criterionName,
            criterionDescription: criterion.criterionDescription,
            maxScore: criterion.maxScore,
            sortOrder: index,
          },
          select: { id: true },
        });

        if (criterion.bandDescriptors.length > 0) {
          await tx.aiRubricBandDescriptor.createMany({
            data: criterion.bandDescriptors.map((descriptor) => ({ criterionId: createdCriterion.id, ...descriptor })),
          });
        }
      }
    });
    imported += 1;
  }

  return { total: rows.length, imported, failed: errors.length, errors };
}
