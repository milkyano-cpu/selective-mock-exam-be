import type { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { createHttpError } from "../../utils/http-error.js";
import {
  IMAGE_SUMMARY_SELECT,
  normalizeImageFileName,
  refreshImageExpirations,
  serializeImageSummary,
  upsertImageMetadata,
} from "../images/images.service.js";
import type { CreatePassageBody, ListPassagesQuery, UpdatePassageBody } from "./passages.schema.js";

// ── Select shape ──────────────────────────────────────────────────────────────

const PASSAGE_SELECT = {
  id:            true,
  externalId:    true,
  title:         true,
  content:       true,
  passageFormat: true,
  imageUrl:      true,
  imageRef:      true,
  image:         { select: IMAGE_SUMMARY_SELECT },
  passageType:   true,
  section:       true,
  difficulty:    true,
  topic:         true,
  latexEnabled:  true,
  notes:         true,
  createdAt:     true,
  updatedAt:     true,
} as const;

const RELATED_QUESTION_SELECT = {
  id:          true,
  questionId:  true,
  subjectId:   true,
  topicId:     true,
  passageId:   true,
  type:        true,
  difficulty:  true,
  status:      true,
  questionText: true,
  createdAt:   true,
  updatedAt:   true,
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findPassageById(prisma: PrismaClient, id: string) {
  const passage = await prisma.passage.findUnique({
    where: { id },
    select: {
      ...PASSAGE_SELECT,
      _count: { select: { questions: true } },
      questions: {
        select: RELATED_QUESTION_SELECT,
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!passage) throw createHttpError(404, "Passage not found");
  return passage;
}

function serializePassage<T extends { image?: Parameters<typeof serializeImageSummary>[0] }>(passage: T) {
  return {
    ...passage,
    image: serializeImageSummary(passage.image ?? null),
  };
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function createPassage(prisma: PrismaClient, body: CreatePassageBody) {
  const nextExternalNumber = await getNextPassageExternalNumber(prisma);
  const externalId = formatPassageExternalId(nextExternalNumber);

  const imageRef = normalizeImageFileName(body.imageRef);
  if (imageRef) {
    await upsertImageMetadata(prisma, { fileName: imageRef, linked: true });
  }

  const created = await prisma.passage.create({
    data: {
      externalId,
      title:         body.title ?? null,
      content:       body.content ?? null,
      passageFormat: body.passageFormat ?? null,
      imageUrl:      body.imageUrl ?? null,
      imageRef:      imageRef || null,
      passageType:   body.passageType ?? null,
      section:       body.section ?? null,
      difficulty:    body.difficulty ?? null,
      topic:         body.topic ?? null,
      latexEnabled:  body.latexEnabled ?? false,
      notes:         body.notes ?? null,
    },
    select: { id: true },
  });

  return serializePassage(await findPassageById(prisma, created.id));
}

export async function listPassages(prisma: PrismaClient, query: ListPassagesQuery) {
  const { page, limit, search } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { content:    { contains: search, mode: "insensitive" } },
      { title:      { contains: search, mode: "insensitive" } },
      { externalId: { contains: search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.passage.findMany({
      where,
      select: {
        ...PASSAGE_SELECT,
        _count: { select: { questions: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.passage.count({ where }),
  ]);

  return {
    data: data.map(serializePassage),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getPassageById(prisma: PrismaClient, id: string) {
  return serializePassage(await findPassageById(prisma, id));
}

export async function updatePassage(prisma: PrismaClient, id: string, body: UpdatePassageBody) {
  const existingPassage = await findPassageById(prisma, id);

  if (body.externalId) {
    const conflict = await prisma.passage.findFirst({
      where: { externalId: body.externalId, NOT: { id } },
      select: { id: true },
    });
    if (conflict) {
      throw createHttpError(409, `Another passage with externalId "${body.externalId}" already exists`);
    }
  }

  const nextImageRef = body.imageRef !== undefined
    ? normalizeImageFileName(body.imageRef)
    : undefined;
  if (nextImageRef) {
    await upsertImageMetadata(prisma, { fileName: nextImageRef, linked: true });
  }

  await prisma.passage.update({
    where: { id },
    data: {
      ...(body.externalId    !== undefined && { externalId:    body.externalId }),
      ...(body.title         !== undefined && { title:         body.title }),
      ...(body.content       !== undefined && { content:       body.content }),
      ...(body.passageFormat !== undefined && { passageFormat: body.passageFormat }),
      ...(body.imageUrl      !== undefined && { imageUrl:      body.imageUrl }),
      ...(body.imageRef      !== undefined && { imageRef:      nextImageRef || null }),
      ...(body.passageType   !== undefined && { passageType:   body.passageType }),
      ...(body.section       !== undefined && { section:       body.section }),
      ...(body.difficulty    !== undefined && { difficulty:    body.difficulty }),
      ...(body.topic         !== undefined && { topic:         body.topic }),
      ...(body.latexEnabled  !== undefined && { latexEnabled:  body.latexEnabled }),
      ...(body.notes         !== undefined && { notes:         body.notes }),
    },
  });

  if (body.imageRef !== undefined) {
    await refreshImageExpirations(prisma, [existingPassage.imageRef, nextImageRef]);
  }

  return serializePassage(await findPassageById(prisma, id));
}

export async function deletePassage(prisma: PrismaClient, id: string) {
  const existingPassage = await findPassageById(prisma, id);

  const linked = await prisma.question.count({ where: { passageId: id } });
  if (linked > 0) {
    throw createHttpError(409, `Cannot delete passage: it is linked to ${linked} question(s)`);
  }

  await prisma.passage.delete({ where: { id } });
  await refreshImageExpirations(prisma, [existingPassage.imageRef]);
}

// ── Import ────────────────────────────────────────────────────────────────────

type CsvRow = Record<string, string | undefined>;

const PASSAGE_TYPE_MAP: Record<string, "TEXT" | "IMAGE" | "TEXT_IMAGE"> = {
  text:       "TEXT",
  TEXT:       "TEXT",
  image:      "IMAGE",
  IMAGE:      "IMAGE",
  "text+image":  "TEXT_IMAGE",
  "TEXT+IMAGE":  "TEXT_IMAGE",
  textimage:     "TEXT_IMAGE",
  TEXTIMAGE:     "TEXT_IMAGE",
  text_image:    "TEXT_IMAGE",
  TEXT_IMAGE:    "TEXT_IMAGE",
  "text image":  "TEXT_IMAGE",
  "TEXT IMAGE":  "TEXT_IMAGE",
};

const DIFFICULTY_MAP: Record<string, string> = {
  easy:   "EASY",
  EASY:   "EASY",
  medium: "MEDIUM",
  MEDIUM: "MEDIUM",
  hard:   "HARD",
  HARD:   "HARD",
};

function parseBool(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase() ?? "";
  return v === "true" || v === "1" || v === "yes";
}

function formatPassageExternalId(number: number) {
  return `RC${String(number).padStart(3, "0")}`;
}

async function getNextPassageExternalNumber(prisma: PrismaClient) {
  const rows = await prisma.passage.findMany({
    where: { externalId: { startsWith: "RC" } },
    select: { externalId: true },
  });

  let max = 0;
  for (const row of rows) {
    const match = row.externalId?.match(/^RC(\d+)$/i);
    if (!match) continue;
    const parsed = parseInt(match[1]!, 10);
    if (Number.isFinite(parsed)) {
      max = Math.max(max, parsed);
    }
  }

  return max + 1;
}

export interface ImportPassagesResult {
  total:   number;
  created: number;
  updated: number;
  failed:  number;
  errors:  Array<{ row: number; reason: string }>;
}

export async function importPassages(
  prisma: PrismaClient,
  buffer: Buffer,
): Promise<ImportPassagesResult> {
  let rows: CsvRow[];

  try {
    rows = parse(buffer, {
      columns:           true,
      skip_empty_lines:  true,
      trim:              true,
    }) as CsvRow[];
  } catch {
    throw createHttpError(400, "Failed to parse CSV file. Ensure it is a valid CSV with the correct headers.");
  }

  if (rows.length > 500) {
    throw createHttpError(400, "CSV exceeds maximum of 500 rows");
  }

  const errors: Array<{ row: number; reason: string }> = [];
  let created = 0;
  let updated = 0;
  let nextExternalNumber = await getNextPassageExternalNumber(prisma);

  for (const [i, raw] of rows.entries()) {
    const rowNumber = i + 2; // +1 for header row, +1 for 1-based

    const title         = raw["PassageTitle"]?.trim() || null;
    const content       = raw["PassageText"]?.trim() || null;
    const passageFormat = raw["PassageFormat"]?.trim() || null;
    const imageUrl      = raw["PassageImageURL"]?.trim() || null;
    const imageRef      = normalizeImageFileName(raw["PassageImageRef"]?.trim() || null) || null;
    const imageAltText  = raw["ImageAltText"]?.trim() || null;
    const imageCaption  = raw["ImagesCaption"]?.trim() || null;
    const rawType       = raw["PassageType"]?.trim() ?? "";
    const section       = raw["Section"]?.trim() || null;
    const rawDiff       = raw["Difficulty"]?.trim() ?? "";
    const topic         = raw["Topic"]?.trim() || null;
    const latexEnabled  = parseBool(raw["LatexEnabled"]);
    const notes         = raw["Notes"]?.trim() || null;

    const rowErrors: string[] = [];

    if (!title) {
      rowErrors.push("PassageTitle is required");
    }

    if (!content) {
      rowErrors.push("PassageText is required");
    }

    const passageType = rawType ? PASSAGE_TYPE_MAP[rawType] : undefined;
    if (rawType && !passageType) {
      rowErrors.push(`PassageType "${rawType}" must be Text, Image, or Text+Image`);
    }

    const difficulty = rawDiff ? (DIFFICULTY_MAP[rawDiff] ?? null) : null;
    if (rawDiff && !difficulty) {
      rowErrors.push(`Difficulty "${rawDiff}" must be Easy, Medium, or Hard`);
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      continue;
    }

    const externalId = formatPassageExternalId(nextExternalNumber++);

    const data = {
      title,
      content,
      passageFormat,
      imageUrl,
      imageRef,
      passageType: passageType ?? null,
      section,
      difficulty,
      topic,
      latexEnabled,
      notes,
    };

    try {
      if (imageRef) {
        await upsertImageMetadata(prisma, {
          fileName: imageRef,
          altText: imageAltText,
          caption: imageCaption,
          linked: true,
        });
      }
      await prisma.passage.create({ data: { externalId, ...data } });
      created++;
    } catch {
      errors.push({ row: rowNumber, reason: "Database error while saving row" });
    }
  }

  const failed = errors.length;
  const total  = rows.length;

  return { total, created, updated, failed, errors };
}
