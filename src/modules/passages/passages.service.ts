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
  id:                   true,
  passageId:            true,
  title:                true,
  text:                 true,
  passageFormat:        true,
  imageRef:             true,
  image:                { select: IMAGE_SUMMARY_SELECT },
  passageType:          true,
  imageDisplayPosition: true,
  subjectId:            true,
  subject:              { select: { id: true, name: true } },
  difficulty:           true,
  topicId:              true,
  topic:                { select: { id: true, name: true } },
  imageAltText:         true,
  imageCaption:         true,
  latexEnabled:         true,
  notes:                true,
  createdAt:            true,
  updatedAt:            true,
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

async function assertReadingSubject(prisma: PrismaClient, subjectId: string) {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { name: true },
  });
  if (!subject) throw createHttpError(404, "Subject not found");
  if (!subject.name.toLowerCase().includes("reading")) {
    throw createHttpError(400, "Passages are only allowed for Reading Comprehension");
  }
}

async function assertTopicBelongsToSubject(prisma: PrismaClient, topicId: string, subjectId: string) {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, subjectId },
    select: { id: true },
  });
  if (!topic) throw createHttpError(400, "Topic must belong to the selected Reading Comprehension subject");
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function createPassage(prisma: PrismaClient, body: CreatePassageBody) {
  if (body.subjectId) await assertReadingSubject(prisma, body.subjectId);
  if (body.topicId && body.subjectId) await assertTopicBelongsToSubject(prisma, body.topicId, body.subjectId);

  const passageId = formatPassageId(await getNextPassageNumber(prisma));

  const imageRef = normalizeImageFileName(body.imageRef);
  if (imageRef) {
    await upsertImageMetadata(prisma, { fileName: imageRef, linked: true });
  }

  const created = await prisma.passage.create({
    data: {
      passageId,
      title:                body.title?.trim() || null,
      text:                 body.text?.trim() || null,
      passageFormat:        body.passageFormat,
      imageRef:             imageRef || null,
      imageAltText:         body.imageAltText ?? null,
      imageCaption:         body.imageCaption ?? null,
      passageType:          body.passageType,
      imageDisplayPosition: body.imageDisplayPosition ?? null,
      subjectId:            body.subjectId,
      topicId:              body.topicId,
      difficulty:           body.difficulty,
      latexEnabled:         body.latexEnabled ?? false,
      notes:                body.notes ?? null,
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
      { text:      { contains: search, mode: "insensitive" } },
      { title:     { contains: search, mode: "insensitive" } },
      { passageId: { contains: search, mode: "insensitive" } },
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

  const nextSubjectId = body.subjectId ?? existingPassage.subjectId;
  const nextTopicId = body.topicId ?? existingPassage.topicId;
  if (nextSubjectId) await assertReadingSubject(prisma, nextSubjectId);
  if (nextTopicId && nextSubjectId) await assertTopicBelongsToSubject(prisma, nextTopicId, nextSubjectId);

  const nextImageRef = body.imageRef !== undefined
    ? normalizeImageFileName(body.imageRef)
    : undefined;
  if (nextImageRef) {
    await upsertImageMetadata(prisma, { fileName: nextImageRef, linked: true });
  }

  await prisma.passage.update({
    where: { id },
    data: {
      ...(body.title                !== undefined && { title:                body.title }),
      ...(body.text                 !== undefined && { text:                 body.text }),
      ...(body.passageFormat        !== undefined && { passageFormat:        body.passageFormat }),
      ...(body.imageRef             !== undefined && { imageRef:             nextImageRef || null }),
      ...(body.imageAltText         !== undefined && { imageAltText:         body.imageAltText }),
      ...(body.imageCaption         !== undefined && { imageCaption:         body.imageCaption }),
      ...(body.passageType          !== undefined && { passageType:          body.passageType }),
      ...(body.imageDisplayPosition !== undefined && { imageDisplayPosition: body.imageDisplayPosition }),
      ...(body.subjectId            !== undefined && { subjectId:            body.subjectId }),
      ...(body.topicId              !== undefined && { topicId:              body.topicId }),
      ...(body.difficulty           !== undefined && { difficulty:           body.difficulty }),
      ...(body.latexEnabled         !== undefined && { latexEnabled:         body.latexEnabled }),
      ...(body.notes                !== undefined && { notes:                body.notes }),
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

type PassageFormatValue = "text" | "poem" | "article" | "visual_text" | "image_only";
type PassageTypeValue = "comprehension" | "poem" | "visual";

const PASSAGE_FORMAT_MAP: Record<string, PassageFormatValue> = {
  text:          "text",
  plain:         "text",
  poem:          "poem",
  poetry:        "poem",
  article:       "article",
  visual:        "visual_text",
  visual_text:   "visual_text",
  visualtext:    "visual_text",
  "visual text": "visual_text",
  "text+image":  "visual_text",
  textimage:     "visual_text",
  text_image:    "visual_text",
  "text image":  "visual_text",
  image:         "image_only",
  image_only:    "image_only",
  imageonly:     "image_only",
  "image only":  "image_only",
};

const PASSAGE_TYPE_MAP: Record<string, PassageTypeValue> = {
  comprehension:         "comprehension",
  "reading comprehension": "comprehension",
  reading_comprehension: "comprehension",
  reading:               "comprehension",
  rc:                    "comprehension",
  text:                  "comprehension",
  article:               "comprehension",
  poem:                  "poem",
  poetry:                "poem",
  visual:                "visual",
  image:                 "visual",
  image_only:            "visual",
  imageonly:             "visual",
  "image only":          "visual",
  visual_text:           "visual",
  visualtext:            "visual",
  "visual text":         "visual",
  "text+image":          "visual",
  textimage:             "visual",
  text_image:            "visual",
  "text image":          "visual",
};

type DifficultyValue = "EASY" | "MEDIUM" | "HARD";
type ImageDisplayPositionValue = "above" | "below" | "inline";

const DIFFICULTY_MAP: Record<string, DifficultyValue> = {
  easy:   "EASY",
  medium: "MEDIUM",
  hard:   "HARD",
};

const IMAGE_DISPLAY_POSITION_MAP: Record<string, ImageDisplayPositionValue> = {
  above:  "above",
  below:  "below",
  inline: "inline",
  middle: "inline",
  beside: "inline",
  main:   "inline",
};

function parseBool(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase() ?? "";
  return v === "true" || v === "1" || v === "yes";
}

function normalizeCsvKey(value: string | undefined | null) {
  return value?.trim().toLowerCase() ?? "";
}

function inferPassageFormat(
  rawFormat: string,
  rawType: string,
  text: string | null,
  imageRef: string | null,
): PassageFormatValue | null {
  if (rawFormat) return PASSAGE_FORMAT_MAP[normalizeCsvKey(rawFormat)] ?? null;
  const legacyTypeFormat = PASSAGE_FORMAT_MAP[normalizeCsvKey(rawType)];
  if (legacyTypeFormat) return legacyTypeFormat;
  if (text && imageRef) return "visual_text";
  if (imageRef) return "image_only";
  if (text) return "text";
  return null;
}

function inferPassageType(rawType: string, passageFormat: PassageFormatValue | null): PassageTypeValue | null {
  const explicitType = PASSAGE_TYPE_MAP[normalizeCsvKey(rawType)];
  if (explicitType) return explicitType;
  if (passageFormat === "poem") return "poem";
  if (passageFormat === "visual_text" || passageFormat === "image_only") return "visual";
  if (passageFormat) return "comprehension";
  return null;
}

function formatPassageId(number: number) {
  return `RC${String(number).padStart(3, "0")}`;
}

async function getNextPassageNumber(prisma: PrismaClient) {
  const rows = await prisma.passage.findMany({
    where: { passageId: { startsWith: "RC" } },
    select: { passageId: true },
  });

  let max = 0;
  for (const row of rows) {
    const match = row.passageId?.match(/^RC(\d+)$/i);
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
  let nextPassageNumber = await getNextPassageNumber(prisma);

  for (const [i, raw] of rows.entries()) {
    const rowNumber = i + 2; // +1 for header row, +1 for 1-based

    const title         = raw["PassageTitle"]?.trim() || null;
    const text          = raw["PassageText"]?.trim() || null;
    const imageRef      = normalizeImageFileName(raw["PassageImageRef"]?.trim() || null) || null;
    const imageAltText  = raw["ImageAltText"]?.trim() || null;
    const imageCaption  = raw["ImageCaption"]?.trim() || null;
    const rawFormat     = raw["PassageFormat"]?.trim() ?? "";
    const rawType       = raw["PassageType"]?.trim() ?? "";
    const rawPosition   = raw["ImageDisplayPosition"]?.trim() ?? "";
    const rawSubject    = raw["Section"]?.trim() || raw["Subject"]?.trim() || null;
    const rawDiff       = raw["Difficulty"]?.trim() ?? "";
    const rawTopic      = raw["Topic"]?.trim() || null;
    const latexEnabled  = parseBool(raw["LatexEnabled"]);
    const notes         = raw["Notes"]?.trim() || null;

    const rowErrors: string[] = [];

    const passageFormat = inferPassageFormat(rawFormat, rawType, text, imageRef);
    if (rawFormat && !passageFormat) {
      rowErrors.push(`PassageFormat "${rawFormat}" must be text, poem, article, visual_text, or image_only`);
    }
    if (!passageFormat) {
      rowErrors.push("PassageFormat is required or must be inferable from PassageText/PassageImageRef");
    }
    if (passageFormat && passageFormat !== "image_only" && !text) {
      rowErrors.push("PassageText is required unless PassageFormat is image_only");
    }

    const passageType = inferPassageType(rawType, passageFormat);
    if (rawType && !passageType) {
      rowErrors.push(`PassageType "${rawType}" must be comprehension, poem, or visual`);
    }
    if (!passageType) {
      rowErrors.push("PassageType is required or must be inferable from PassageFormat");
    }

    const imageDisplayPosition = rawPosition ? IMAGE_DISPLAY_POSITION_MAP[rawPosition.toLowerCase()] : undefined;
    if (rawPosition && !imageDisplayPosition) {
      rowErrors.push(`ImageDisplayPosition "${rawPosition}" must be above, below, or inline`);
    }

    const difficulty = rawDiff ? (DIFFICULTY_MAP[rawDiff.toLowerCase()] ?? null) : null;
    if (!rawDiff) {
      rowErrors.push("Difficulty is required");
    } else if (!difficulty) {
      rowErrors.push(`Difficulty "${rawDiff}" must be Easy, Medium, or Hard`);
    }

    // Resolve subject/topic names to IDs
    let subjectId: string | null = null;
    let topicId: string | null = null;
    if (!rawSubject) {
      rowErrors.push("Section is required");
    } else {
      const subject = await prisma.subject.findFirst({
        where: { name: { equals: rawSubject, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (!subject) {
        rowErrors.push(`Section "${rawSubject}" was not found`);
      } else if (!subject.name.toLowerCase().includes("reading")) {
        rowErrors.push("Passages are only allowed for Reading Comprehension");
      } else {
        subjectId = subject.id;
      }
    }

    if (!rawTopic) {
      rowErrors.push("Topic is required");
    } else if (subjectId) {
      const topicRecord = await prisma.topic.findFirst({
        where: { name: { equals: rawTopic, mode: "insensitive" }, subjectId },
        select: { id: true },
      });
      if (!topicRecord) {
        rowErrors.push(`Topic "${rawTopic}" was not found for Section "${rawSubject}"`);
      } else {
        topicId = topicRecord.id;
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      continue;
    }

    const data = {
      title,
      text,
      passageFormat: passageFormat!,
      imageRef,
      imageAltText,
      imageCaption,
      passageType: passageType!,
      imageDisplayPosition: imageDisplayPosition ?? null,
      subjectId: subjectId!,
      difficulty: difficulty!,
      topicId: topicId!,
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
      await prisma.passage.create({
        data: { passageId: formatPassageId(nextPassageNumber), ...data },
      });
      nextPassageNumber++;
      created++;
    } catch {
      errors.push({ row: rowNumber, reason: "Database error while saving row" });
    }
  }

  const failed = errors.length;
  const total  = rows.length;

  return { total, created, updated, failed, errors };
}
