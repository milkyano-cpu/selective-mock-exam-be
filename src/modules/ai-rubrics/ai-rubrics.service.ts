import { Prisma, type PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { createHttpError } from "../../utils/http-error.js";
import { assertWritingTypeAllowed } from "../ai-rubric-writing-types/ai-rubric-writing-types.service.js";
import type {
  CreateAiRubricBody,
  ListAiRubricsQuery,
  UpdateAiRubricBody,
  CreateCriterionInput,
  UpdateCriterionInput,
  CreateBandInput,
  UpdateBandInput,
  CreateCalibrationNoteInput,
  UpdateCalibrationNoteInput,
} from "./ai-rubrics.schema.js";

type AiRubricCsvRow = {
  AIRubricID?: string;
  AIRubricName?: string;
  WritingType?: string;
  IsDefault?: string;
  TotalMaxScore?: string;
  CriterionName?: string;
  CriterionDescription?: string;
  HighScoringIndicators?: string;
  LowScoringIndicators?: string;
  AICalibrationNotes?: string;
  MaxScore?: string;
  BandDescriptors?: string;
  BandLabel?: string;
  BandScoreMin?: string;
  BandScoreMax?: string;
  BandDescriptor?: string;
  CalibrationNoteType?: string;
  CalibrationNote?: string;
};

const AI_RUBRIC_SELECT = {
  id: true,
  name: true,
  writingType: true,
  isDefault: true,
  isActive: true,
  totalMaxScore: true,
  createdAt: true,
  updatedAt: true,
} as const;

const AI_RUBRIC_DETAIL_SELECT = {
  ...AI_RUBRIC_SELECT,
  bandDescriptors: {
    select: {
      id: true,
      aiRubricId: true,
      bandLabel: true,
      scoreMin: true,
      scoreMax: true,
      descriptor: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ scoreMin: "asc" }, { scoreMax: "asc" }],
  },
  calibrationNotes: {
    select: {
      id: true,
      aiRubricId: true,
      category: true,
      instruction: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { sortOrder: "asc" },
  },
  criteria: {
    select: {
      id: true,
      aiRubricId: true,
      criterionName: true,
      criterionDescription: true,
      maxScore: true,
      sortOrder: true,
      highScoringIndicators: true,
      lowScoringIndicators: true,
      aiCalibrationNotes: true,
      createdAt: true,
      updatedAt: true,
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

      return { bandLabel: `${scoreMin}-${scoreMax}`, scoreMin, scoreMax, descriptor };
    });
}

function parsePipeList(value: string | undefined) {
  return value?.trim()
    ? value.split("|").map((item) => item.trim()).filter(Boolean)
    : [];
}

function normaliseBandDescriptor(descriptor: { bandLabel?: string | undefined; scoreMin: number; scoreMax: number; descriptor: string }) {
  return {
    bandLabel: descriptor.bandLabel?.trim() || `${descriptor.scoreMin}-${descriptor.scoreMax}`,
    scoreMin: descriptor.scoreMin,
    scoreMax: descriptor.scoreMax,
    descriptor: descriptor.descriptor,
  };
}

function collectRubricBands(body: CreateAiRubricBody | UpdateAiRubricBody) {
  const explicit = body.bandDescriptors ?? [];
  const legacy = (body.criteria ?? []).flatMap((criterion) => criterion.bandDescriptors ?? []);
  const seen = new Set<string>();

  return [...explicit, ...legacy]
    .map(normaliseBandDescriptor)
    .filter((descriptor) => {
      const key = `${descriptor.bandLabel}|${descriptor.scoreMin}|${descriptor.scoreMax}|${descriptor.descriptor}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function replaceAiRubricCriteria(
  tx: Prisma.TransactionClient,
  aiRubricId: string,
  criteria: NonNullable<CreateAiRubricBody["criteria"] | UpdateAiRubricBody["criteria"]>,
) {
  await tx.aiRubricCriterion.deleteMany({ where: { aiRubricId } });

  for (const [index, criterion] of criteria.entries()) {
    await tx.aiRubricCriterion.create({
      data: {
        aiRubricId,
        criterionName: criterion.criterionName,
        criterionDescription: criterion.criterionDescription,
        maxScore: criterion.maxScore,
        sortOrder: criterion.sortOrder ?? index,
        highScoringIndicators: criterion.highScoringIndicators ?? [],
        lowScoringIndicators: criterion.lowScoringIndicators ?? [],
        aiCalibrationNotes: criterion.aiCalibrationNotes ?? [],
      },
    });
  }
}

async function replaceAiRubricBands(
  tx: Prisma.TransactionClient,
  aiRubricId: string,
  bandDescriptors: NonNullable<CreateAiRubricBody["bandDescriptors"] | UpdateAiRubricBody["bandDescriptors"]>,
) {
  const bandDelegate = tx.aiRubricBandDescriptor as typeof tx.aiRubricBandDescriptor & {
    deleteMany?: (args: { where: { aiRubricId: string } }) => Promise<unknown>;
  };
  if (bandDelegate.deleteMany) {
    await bandDelegate.deleteMany({ where: { aiRubricId } });
  }
  if (bandDescriptors.length === 0) return;

  await bandDelegate.createMany({
    data: bandDescriptors.map((descriptor) => ({
      aiRubricId,
      ...normaliseBandDescriptor(descriptor),
    })),
  });
}

async function replaceAiRubricCalibrationNotes(
  tx: Prisma.TransactionClient,
  aiRubricId: string,
  calibrationNotes: NonNullable<CreateAiRubricBody["calibrationNotes"] | UpdateAiRubricBody["calibrationNotes"]>,
) {
  const noteDelegate = (tx as Prisma.TransactionClient & {
    aiCalibrationNote?: {
      deleteMany?: (args: { where: { aiRubricId: string } }) => Promise<unknown>;
      createMany?: (args: { data: Array<{ aiRubricId: string; category: string | null; instruction: string; sortOrder: number }> }) => Promise<unknown>;
    };
  }).aiCalibrationNote;
  if (noteDelegate?.deleteMany) {
    await noteDelegate.deleteMany({ where: { aiRubricId } });
  }
  if (calibrationNotes.length === 0) return;

  await noteDelegate?.createMany?.({
    data: calibrationNotes.map((note, index) => ({
      aiRubricId,
      category: note.category ?? null,
      instruction: note.instruction,
      sortOrder: note.sortOrder ?? index,
    })),
  });
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

function validateCriteriaTotalMaxScore(
  criteria: Array<{ maxScore: number }> | undefined,
  totalMaxScore: number,
) {
  if (!criteria || criteria.length === 0) return;
  const criteriaTotal = criteria.reduce((sum, c) => sum + c.maxScore, 0);
  if (criteriaTotal !== totalMaxScore) {
    throw createHttpError(
      400,
      `Sum of criteria maxScore (${criteriaTotal}) must equal rubric totalMaxScore (${totalMaxScore})`,
    );
  }
}

export async function createAiRubric(prisma: PrismaClient, body: CreateAiRubricBody) {
  validateCriteriaTotalMaxScore(body.criteria, body.totalMaxScore);
  await assertWritingTypeAllowed(prisma, body.writingType ?? null);
  await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      await tx.aiRubric.updateMany({
        where: { isDefault: true, writingType: body.writingType ?? null },
        data: { isDefault: false },
      });
    }

    await tx.aiRubric.create({
      data: {
        id: body.id,
        name: body.name,
        writingType: body.writingType ?? null,
        isDefault: body.isDefault ?? false,
        isActive: body.isActive ?? true,
        totalMaxScore: body.totalMaxScore,
      },
    });

    if (body.criteria !== undefined) {
      await replaceAiRubricCriteria(tx, body.id, body.criteria);
    }
    const bandDescriptors = collectRubricBands(body);
    if (body.bandDescriptors !== undefined || bandDescriptors.length > 0) {
      await replaceAiRubricBands(tx, body.id, bandDescriptors);
    }
    if (body.calibrationNotes !== undefined) {
      await replaceAiRubricCalibrationNotes(tx, body.id, body.calibrationNotes);
    }
  });

  return getAiRubricById(prisma, body.id);
}

export async function updateAiRubric(prisma: PrismaClient, id: string, body: UpdateAiRubricBody) {
  if (body.criteria !== undefined) {
    const effectiveTotalMaxScore = body.totalMaxScore ?? (await prisma.aiRubric.findUnique({ where: { id }, select: { totalMaxScore: true } }))?.totalMaxScore;
    if (effectiveTotalMaxScore !== undefined) {
      validateCriteriaTotalMaxScore(body.criteria, effectiveTotalMaxScore);
    }
  }
  if (body.writingType !== undefined) {
    await assertWritingTypeAllowed(prisma, body.writingType);
  }
  await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      const where: Prisma.AiRubricWhereInput = { isDefault: true, id: { not: id } };
      if (body.writingType !== undefined) where.writingType = body.writingType;
      await tx.aiRubric.updateMany({
        where,
        data: { isDefault: false },
      });
    }

    await tx.aiRubric.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.writingType !== undefined ? { writingType: body.writingType } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.totalMaxScore !== undefined ? { totalMaxScore: body.totalMaxScore } : {}),
      },
    });

    if (body.criteria !== undefined) {
      await replaceAiRubricCriteria(tx, id, body.criteria);
    }
    if (body.bandDescriptors !== undefined || body.criteria?.some((criterion) => criterion.bandDescriptors?.length)) {
      await replaceAiRubricBands(tx, id, collectRubricBands(body));
    }
    if (body.calibrationNotes !== undefined) {
      await replaceAiRubricCalibrationNotes(tx, id, body.calibrationNotes);
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

  // Pre-fetch allowed writing types for validation
  const allowedWritingTypes = new Set(
    (await prisma.aiRubricWritingType.findMany({ select: { name: true } })).map((w) => w.name),
  );

  const errors: Array<{ row: number; reason: string }> = [];
  const grouped = new Map<string, {
    meta: { name: string; writingType: string | null; isDefault: boolean; totalMaxScore: number };
    criteria: Array<{
      criterionName: string;
      criterionDescription: string;
      maxScore: number;
      highScoringIndicators: string[];
      lowScoringIndicators: string[];
      aiCalibrationNotes: string[];
    }>;
    bandDescriptors: ReturnType<typeof parseBandDescriptors>;
    calibrationNotes: Array<{ category: string | null; instruction: string; sortOrder: number }>;
  }>();

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

    const writingTypeRaw = row.WritingType?.trim().toUpperCase();
    if (writingTypeRaw && !allowedWritingTypes.has(writingTypeRaw)) {
      rowErrors.push(`WritingType "${writingTypeRaw}" is not registered. Allowed values: ${[...allowedWritingTypes].join(", ") || "(none — create writing types first)"}`);
    }

    let bandDescriptors: ReturnType<typeof parseBandDescriptors> = [];
    try {
      bandDescriptors = parseBandDescriptors(row.BandDescriptors);
      if (row.BandDescriptor?.trim()) {
        const scoreMin = parseInt(row.BandScoreMin?.trim() ?? "", 10);
        const scoreMax = parseInt(row.BandScoreMax?.trim() ?? "", 10);
        if (!Number.isFinite(scoreMin) || !Number.isFinite(scoreMax) || scoreMax < scoreMin) {
          rowErrors.push("BandScoreMin/BandScoreMax must be valid when BandDescriptor is provided");
        } else {
          bandDescriptors.push({
            bandLabel: row.BandLabel?.trim() || `${scoreMin}-${scoreMax}`,
            scoreMin,
            scoreMax,
            descriptor: row.BandDescriptor.trim(),
          });
        }
      }
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
          writingType: writingTypeRaw || null,
          isDefault: parseBoolean(row.IsDefault),
          totalMaxScore,
        },
        criteria: [],
        bandDescriptors: [],
        calibrationNotes: [],
      });
    }

    const group = grouped.get(aiRubricId)!;
    group.criteria.push({
      criterionName,
      criterionDescription,
      maxScore,
      highScoringIndicators: parsePipeList(row.HighScoringIndicators),
      lowScoringIndicators: parsePipeList(row.LowScoringIndicators),
      aiCalibrationNotes: parsePipeList(row.AICalibrationNotes),
    });
    group.bandDescriptors.push(...bandDescriptors);
    const calibrationNote = row.CalibrationNote?.trim();
    if (calibrationNote) {
      group.calibrationNotes.push({
        category: row.CalibrationNoteType?.trim() || null,
        instruction: calibrationNote,
        sortOrder: group.calibrationNotes.length,
      });
    }
  });

  let imported = 0;
  for (const [aiRubricId, data] of grouped.entries()) {
    await prisma.$transaction(async (tx) => {
      if (data.meta.isDefault) {
        await tx.aiRubric.updateMany({
          where: { isDefault: true, id: { not: aiRubricId }, writingType: data.meta.writingType },
          data: { isDefault: false },
        });
      }

      await tx.aiRubric.upsert({
        where: { id: aiRubricId },
        create: { id: aiRubricId, ...data.meta, isActive: true },
        update: { ...data.meta, isActive: true },
      });

      await tx.aiRubricCriterion.deleteMany({ where: { aiRubricId } });
      const bandDelegate = tx.aiRubricBandDescriptor as typeof tx.aiRubricBandDescriptor & {
        deleteMany?: (args: { where: { aiRubricId: string } }) => Promise<unknown>;
      };
      await bandDelegate.deleteMany?.({ where: { aiRubricId } });
      const noteDelegate = (tx as Prisma.TransactionClient & {
        aiCalibrationNote?: {
          deleteMany?: (args: { where: { aiRubricId: string } }) => Promise<unknown>;
          createMany?: (args: { data: Array<{ aiRubricId: string; category: string | null; instruction: string; sortOrder: number }> }) => Promise<unknown>;
        };
      }).aiCalibrationNote;
      await noteDelegate?.deleteMany?.({ where: { aiRubricId } });

      for (const [index, criterion] of data.criteria.entries()) {
        await tx.aiRubricCriterion.create({
          data: {
            aiRubricId,
            criterionName: criterion.criterionName,
            criterionDescription: criterion.criterionDescription,
            maxScore: criterion.maxScore,
            sortOrder: index,
            highScoringIndicators: criterion.highScoringIndicators,
            lowScoringIndicators: criterion.lowScoringIndicators,
            aiCalibrationNotes: criterion.aiCalibrationNotes,
          },
        });
      }

      const seenBands = new Set<string>();
      const uniqueBands = data.bandDescriptors
        .map(normaliseBandDescriptor)
        .filter((descriptor) => {
          const key = `${descriptor.bandLabel}|${descriptor.scoreMin}|${descriptor.scoreMax}|${descriptor.descriptor}`;
          if (seenBands.has(key)) return false;
          seenBands.add(key);
          return true;
        });
      if (uniqueBands.length > 0) {
        await bandDelegate.createMany({
          data: uniqueBands.map((descriptor) => ({ aiRubricId, ...descriptor })),
        });
      }

      if (data.calibrationNotes.length > 0) {
        await noteDelegate?.createMany?.({
          data: data.calibrationNotes.map((note) => ({ aiRubricId, ...note })),
        });
      }
    });
    imported += 1;
  }

  return { total: rows.length, imported, failed: errors.length, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-entity CRUD: Criteria
// ═══════════════════════════════════════════════════════════════════════════

async function assertRubricExists(prisma: PrismaClient, rubricId: string) {
  const rubric = await prisma.aiRubric.findUnique({
    where: { id: rubricId },
    select: { id: true },
  });
  if (!rubric) throw createHttpError(404, "AI rubric not found");
}

function serializeCriterion(c: {
  id: string;
  aiRubricId: string;
  criterionName: string;
  criterionDescription: string;
  maxScore: number;
  sortOrder: number;
  highScoringIndicators: string[];
  lowScoringIndicators: string[];
  aiCalibrationNotes: string[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function createCriterion(
  prisma: PrismaClient,
  rubricId: string,
  input: CreateCriterionInput,
) {
  await assertRubricExists(prisma, rubricId);
  const last = await prisma.aiRubricCriterion.findFirst({
    where: { aiRubricId: rubricId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = input.sortOrder ?? (last ? last.sortOrder + 1 : 0);
  const created = await prisma.aiRubricCriterion.create({
    data: {
      aiRubricId: rubricId,
      criterionName: input.criterionName,
      criterionDescription: input.criterionDescription,
      maxScore: input.maxScore,
      sortOrder,
      highScoringIndicators: input.highScoringIndicators ?? [],
      lowScoringIndicators: input.lowScoringIndicators ?? [],
      aiCalibrationNotes: input.aiCalibrationNotes ?? [],
    },
  });
  return serializeCriterion(created);
}

export async function updateCriterion(
  prisma: PrismaClient,
  rubricId: string,
  criterionId: string,
  input: UpdateCriterionInput,
) {
  const existing = await prisma.aiRubricCriterion.findUnique({ where: { id: criterionId } });
  if (!existing || existing.aiRubricId !== rubricId) {
    throw createHttpError(404, "Criterion not found for this rubric");
  }
  const updated = await prisma.aiRubricCriterion.update({
    where: { id: criterionId },
    data: {
      ...(input.criterionName !== undefined ? { criterionName: input.criterionName } : {}),
      ...(input.criterionDescription !== undefined ? { criterionDescription: input.criterionDescription } : {}),
      ...(input.maxScore !== undefined ? { maxScore: input.maxScore } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.highScoringIndicators !== undefined ? { highScoringIndicators: input.highScoringIndicators } : {}),
      ...(input.lowScoringIndicators !== undefined ? { lowScoringIndicators: input.lowScoringIndicators } : {}),
      ...(input.aiCalibrationNotes !== undefined ? { aiCalibrationNotes: input.aiCalibrationNotes } : {}),
    },
  });
  return serializeCriterion(updated);
}

export async function deleteCriterion(
  prisma: PrismaClient,
  rubricId: string,
  criterionId: string,
) {
  const existing = await prisma.aiRubricCriterion.findUnique({ where: { id: criterionId } });
  if (!existing || existing.aiRubricId !== rubricId) {
    throw createHttpError(404, "Criterion not found for this rubric");
  }
  await prisma.aiRubricCriterion.delete({ where: { id: criterionId } });
}

async function loadExistingRubricIds(prisma: PrismaClient, ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const found = await prisma.aiRubric.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return new Set(found.map((r) => r.id));
}

export async function importCriteriaCsv(prisma: PrismaClient, buffer: Buffer) {
  let rows: Record<string, string | undefined>[];
  try {
    rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string | undefined>[];
  } catch {
    throw createHttpError(400, "Failed to parse criteria CSV file");
  }
  if (rows.length > 500) throw createHttpError(400, "CSV exceeds maximum of 500 rows");

  // Validate all referenced rubric IDs exist
  const referenced = [...new Set(rows.map((r) => (r.RubricID ?? "").trim()).filter(Boolean))];
  const existing = await loadExistingRubricIds(prisma, referenced);

  // Track next sortOrder per rubric (start from current max+1)
  const nextOrderByRubric = new Map<string, number>();
  for (const rid of existing) {
    const last = await prisma.aiRubricCriterion.findFirst({
      where: { aiRubricId: rid },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    nextOrderByRubric.set(rid, last ? last.sortOrder + 1 : 0);
  }

  const errors: Array<{ row: number; reason: string }> = [];
  const toCreate: Array<Prisma.AiRubricCriterionCreateManyInput> = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const rubricId = (row.RubricID ?? "").trim();
    const name = (row.Criterion ?? row.CriterionName ?? "").trim();
    const description = (row.Measures ?? row.CriterionDescription ?? "").trim();
    const maxScoreRaw = (row.WeightOutOf100 ?? row.MaxScore ?? "").trim();
    const maxScore = parseInt(maxScoreRaw, 10);
    const sortOrderRaw = (row.SortOrder ?? "").trim();
    const sortOrderFromRow = sortOrderRaw ? parseInt(sortOrderRaw, 10) : NaN;
    const high = parsePipeList(row.HighScoringIndicators);
    const low = parsePipeList(row.LowScoringIndicators);
    const notes = parsePipeList(row.AI_CalibrationNotes ?? row.AICalibrationNotes);

    const rowErrors: string[] = [];
    if (!rubricId) rowErrors.push("RubricID is required");
    else if (!existing.has(rubricId)) rowErrors.push(`RubricID "${rubricId}" does not exist`);
    if (!name) rowErrors.push("CriterionName (or Criterion) is required");
    if (!description) rowErrors.push("CriterionDescription (or Measures) is required");
    if (!Number.isFinite(maxScore) || maxScore < 1) rowErrors.push("MaxScore (or WeightOutOf100) must be a positive integer");

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      return;
    }

    const sortOrder = Number.isFinite(sortOrderFromRow)
      ? sortOrderFromRow
      : (nextOrderByRubric.get(rubricId) ?? 0);
    nextOrderByRubric.set(rubricId, Math.max((nextOrderByRubric.get(rubricId) ?? 0), sortOrder + 1));

    toCreate.push({
      aiRubricId: rubricId,
      criterionName: name,
      criterionDescription: description,
      maxScore,
      sortOrder,
      highScoringIndicators: high,
      lowScoringIndicators: low,
      aiCalibrationNotes: notes,
    });
  });

  if (toCreate.length > 0) {
    await prisma.aiRubricCriterion.createMany({ data: toCreate });
  }

  return { total: rows.length, imported: toCreate.length, failed: errors.length, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-entity CRUD: Band Descriptors
// ═══════════════════════════════════════════════════════════════════════════

function serializeBand(b: {
  id: string;
  aiRubricId: string;
  bandLabel: string;
  scoreMin: number;
  scoreMax: number;
  descriptor: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...b,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export async function createBandDescriptor(
  prisma: PrismaClient,
  rubricId: string,
  input: CreateBandInput,
) {
  await assertRubricExists(prisma, rubricId);
  if (input.scoreMax < input.scoreMin) {
    throw createHttpError(400, "scoreMax must be greater than or equal to scoreMin");
  }
  const created = await prisma.aiRubricBandDescriptor.create({
    data: {
      aiRubricId: rubricId,
      bandLabel: input.bandLabel ?? `${input.scoreMin}-${input.scoreMax}`,
      scoreMin: input.scoreMin,
      scoreMax: input.scoreMax,
      descriptor: input.descriptor,
    },
  });
  return serializeBand(created);
}

export async function updateBandDescriptor(
  prisma: PrismaClient,
  rubricId: string,
  bandId: string,
  input: UpdateBandInput,
) {
  const existing = await prisma.aiRubricBandDescriptor.findUnique({ where: { id: bandId } });
  if (!existing || existing.aiRubricId !== rubricId) {
    throw createHttpError(404, "Band descriptor not found for this rubric");
  }
  const nextMin = input.scoreMin ?? existing.scoreMin;
  const nextMax = input.scoreMax ?? existing.scoreMax;
  if (nextMax < nextMin) {
    throw createHttpError(400, "scoreMax must be greater than or equal to scoreMin");
  }
  const updated = await prisma.aiRubricBandDescriptor.update({
    where: { id: bandId },
    data: {
      ...(input.bandLabel !== undefined ? { bandLabel: input.bandLabel } : {}),
      ...(input.scoreMin !== undefined ? { scoreMin: input.scoreMin } : {}),
      ...(input.scoreMax !== undefined ? { scoreMax: input.scoreMax } : {}),
      ...(input.descriptor !== undefined ? { descriptor: input.descriptor } : {}),
    },
  });
  return serializeBand(updated);
}

export async function deleteBandDescriptor(
  prisma: PrismaClient,
  rubricId: string,
  bandId: string,
) {
  const existing = await prisma.aiRubricBandDescriptor.findUnique({ where: { id: bandId } });
  if (!existing || existing.aiRubricId !== rubricId) {
    throw createHttpError(404, "Band descriptor not found for this rubric");
  }
  await prisma.aiRubricBandDescriptor.delete({ where: { id: bandId } });
}

export async function importBandsCsv(prisma: PrismaClient, buffer: Buffer) {
  let rows: Record<string, string | undefined>[];
  try {
    rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string | undefined>[];
  } catch {
    throw createHttpError(400, "Failed to parse bands CSV file");
  }
  if (rows.length > 500) throw createHttpError(400, "CSV exceeds maximum of 500 rows");

  const referenced = [...new Set(rows.map((r) => (r.RubricID ?? "").trim()).filter(Boolean))];
  const existing = await loadExistingRubricIds(prisma, referenced);

  const errors: Array<{ row: number; reason: string }> = [];
  const toCreate: Array<Prisma.AiRubricBandDescriptorCreateManyInput> = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const rubricId = (row.RubricID ?? "").trim();
    const bandLabel = (row.Band ?? row.BandLabel ?? "").trim();
    const scoreMinRaw = (row.MinScore ?? row.ScoreMin ?? "").trim();
    const scoreMaxRaw = (row.MaxScore ?? row.ScoreMax ?? "").trim();
    const descriptor = (row.Descriptor ?? "").trim();
    const scoreMin = parseInt(scoreMinRaw, 10);
    const scoreMax = parseInt(scoreMaxRaw, 10);

    const rowErrors: string[] = [];
    if (!rubricId) rowErrors.push("RubricID is required");
    else if (!existing.has(rubricId)) rowErrors.push(`RubricID "${rubricId}" does not exist`);
    if (!bandLabel) rowErrors.push("BandLabel (or Band) is required");
    if (!descriptor) rowErrors.push("Descriptor is required");
    if (!Number.isFinite(scoreMin) || scoreMin < 0) rowErrors.push("ScoreMin (or MinScore) must be a non-negative integer");
    if (!Number.isFinite(scoreMax) || scoreMax < scoreMin) rowErrors.push("ScoreMax (or MaxScore) must be >= ScoreMin");

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      return;
    }

    toCreate.push({
      aiRubricId: rubricId,
      bandLabel,
      scoreMin,
      scoreMax,
      descriptor,
    });
  });

  if (toCreate.length > 0) {
    await prisma.aiRubricBandDescriptor.createMany({ data: toCreate });
  }

  return { total: rows.length, imported: toCreate.length, failed: errors.length, errors };
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-entity CRUD: Calibration Notes
// ═══════════════════════════════════════════════════════════════════════════

function serializeCalibrationNote(n: {
  id: string;
  aiRubricId: string;
  category: string | null;
  instruction: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...n,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

export async function createCalibrationNote(
  prisma: PrismaClient,
  rubricId: string,
  input: CreateCalibrationNoteInput,
) {
  await assertRubricExists(prisma, rubricId);
  const last = await prisma.aiCalibrationNote.findFirst({
    where: { aiRubricId: rubricId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = input.sortOrder ?? (last ? last.sortOrder + 1 : 0);
  const created = await prisma.aiCalibrationNote.create({
    data: {
      aiRubricId: rubricId,
      category: input.category ?? null,
      instruction: input.instruction,
      sortOrder,
    },
  });
  return serializeCalibrationNote(created);
}

export async function updateCalibrationNote(
  prisma: PrismaClient,
  rubricId: string,
  noteId: string,
  input: UpdateCalibrationNoteInput,
) {
  const existing = await prisma.aiCalibrationNote.findUnique({ where: { id: noteId } });
  if (!existing || existing.aiRubricId !== rubricId) {
    throw createHttpError(404, "Calibration note not found for this rubric");
  }
  const updated = await prisma.aiCalibrationNote.update({
    where: { id: noteId },
    data: {
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
  return serializeCalibrationNote(updated);
}

export async function deleteCalibrationNote(
  prisma: PrismaClient,
  rubricId: string,
  noteId: string,
) {
  const existing = await prisma.aiCalibrationNote.findUnique({ where: { id: noteId } });
  if (!existing || existing.aiRubricId !== rubricId) {
    throw createHttpError(404, "Calibration note not found for this rubric");
  }
  await prisma.aiCalibrationNote.delete({ where: { id: noteId } });
}

export async function importCalibrationNotesCsv(prisma: PrismaClient, buffer: Buffer) {
  let rows: Record<string, string | undefined>[];
  try {
    rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string | undefined>[];
  } catch {
    throw createHttpError(400, "Failed to parse calibration notes CSV file");
  }
  if (rows.length > 500) throw createHttpError(400, "CSV exceeds maximum of 500 rows");

  const referenced = [...new Set(rows.map((r) => (r.RubricID ?? "").trim()).filter(Boolean))];
  const existing = await loadExistingRubricIds(prisma, referenced);

  const nextOrderByRubric = new Map<string, number>();
  for (const rid of existing) {
    const last = await prisma.aiCalibrationNote.findFirst({
      where: { aiRubricId: rid },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    nextOrderByRubric.set(rid, last ? last.sortOrder + 1 : 0);
  }

  const errors: Array<{ row: number; reason: string }> = [];
  const toCreate: Array<Prisma.AiCalibrationNoteCreateManyInput> = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const rubricId = (row.RubricID ?? "").trim();
    const category = (row.Category ?? "").trim() || null;
    const instruction = (row.Instruction ?? "").trim();
    const sortOrderRaw = (row.SortOrder ?? "").trim();
    const sortOrderFromRow = sortOrderRaw ? parseInt(sortOrderRaw, 10) : NaN;

    const rowErrors: string[] = [];
    if (!rubricId) rowErrors.push("RubricID is required");
    else if (!existing.has(rubricId)) rowErrors.push(`RubricID "${rubricId}" does not exist`);
    if (!instruction) rowErrors.push("Instruction is required");

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      return;
    }

    const sortOrder = Number.isFinite(sortOrderFromRow)
      ? sortOrderFromRow
      : (nextOrderByRubric.get(rubricId) ?? 0);
    nextOrderByRubric.set(rubricId, Math.max((nextOrderByRubric.get(rubricId) ?? 0), sortOrder + 1));

    toCreate.push({
      aiRubricId: rubricId,
      category,
      instruction,
      sortOrder,
    });
  });

  if (toCreate.length > 0) {
    await prisma.aiCalibrationNote.createMany({ data: toCreate });
  }

  return { total: rows.length, imported: toCreate.length, failed: errors.length, errors };
}
