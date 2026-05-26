import { randomUUID } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { createHttpError } from "../../utils/http-error.js";
import {
  findMissingImageRefs,
  loadImageSummariesByFileNames,
  markImagesLinked,
  normalizeImageFileName,
  refreshImageExpirations,
} from "../images/images.service.js";
import { assertWritingTypeAllowed } from "../ai-rubric-writing-types/ai-rubric-writing-types.service.js";
import type { CreateQuestionBody, ListQuestionsQuery, RejectQuestionBody, ResolveImportBody, UnresolvedRowData, UnresolvedRowItem, UpdateQuestionBody } from "./questions.schema.js";

// ── Select shape ──────────────────────────────────────────────────────────────

const QUESTION_SELECT = {
  id: true,
  questionId: true,
  questionNumber: true,
  subjectId: true,
  topicId: true,
  tutorId: true,
  passageId: true,
  aiRubricId: true,
  type: true,
  difficulty: true,
  questionText: true,
  writingType: true,
  promptText: true,
  markingGuide: true,
  options: true,
  correctAnswer: true,
  explanation: true,
  timeLimitSeconds: true,
  imageRefs: true,
  subtopics: true,
  notes: true,
  latexEnabled: true,
  adaptiveTags: true,
  skillTags: true,
  markingType: true,
  maxMarks: true,
  isPracticeAllowed: true,
  status: true,
  rejectionNote: true,
  createdAt: true,
  updatedAt: true,
  subject: {
    select: {
      name: true,
    },
  },
  topic: {
    select: {
      name: true,
    },
  },
  aiRubric: {
    select: {
      id: true,
      name: true,
      totalMaxScore: true,
    },
  },
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type BulkImportResult = {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  unresolved: number;
  errors: Array<{ row: number; reason: string }>;
  skippedErrors: Array<{ row: number; reason: string }>;
  unresolvedRows: UnresolvedRowItem[];
  createdQuestions: Array<{ rowNumber: number; question: ReturnType<typeof serializeQuestion> }>;
};

type QuestionRecord = Prisma.QuestionGetPayload<{ select: typeof QUESTION_SELECT }>;

export type SerializedQuestion = ReturnType<typeof serializeQuestion> & {
  images: Array<{ fileName: string; url: string | null; altText: string | null; caption: string | null }>;
};

function serializeQuestion(question: QuestionRecord) {
  const { subject, topic, aiRubric, ...rest } = question;

  return {
    ...rest,
    subjectName: subject.name,
    topicName: topic.name,
    aiRubric,
  };
}

async function attachImages<T extends { imageRefs: string[] }>(prisma: PrismaClient, q: T) {
  const summaries = await loadImageSummariesByFileNames(prisma, q.imageRefs);
  return {
    ...q,
    images: q.imageRefs.map((fileName) => {
      const found = summaries.get(fileName);
      return {
        fileName,
        url: found?.url ?? null,
        altText: found?.altText ?? null,
        caption: found?.caption ?? null,
      };
    }),
  };
}

function splitImageRefs(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

// Matches UnresolvedRowData in schema — kept in sync manually
type NormalisedRow = UnresolvedRowData & { latexEnabled: boolean };

type InsertableRow = NormalisedRow & {
  rowNumber: number;
  resolvedSubjectId: string;
  resolvedTopicId: string;
};

type QuestionIdSeed = {
  prefix: string;
  nextNumber: number;
};

// Matches the updated CSV template columns
type CsvRow = {
  QuestionID?: string; // kept for backward-compat but ignored — IDs are auto-generated
  Section: string;
  QuestionNumber: string;
  QuestionText: string;
  WritingType?: string;
  PromptText?: string;
  MarkingGuide?: string;
  OptionA: string;
  OptionB: string;
  OptionC: string;
  OptionD: string;
  OptionE: string;
  CorrectAnswer: string;
  Explanation: string;
  Difficulty: string;
  Topic: string;
  Subtopics: string;
  TimeLimitSeconds: string;
  ImageURL: string;
  ImageRef: string;
  PassageID: string;
  Notes: string;
  QuestionType?: string;
  LatexEnabled?: string;
  MarkingType?: string;
  MaxMarks?: string;
  AIRubricID?: string;
  AdaptiveTags?: string;
  SkillTags?: string;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

async function findQuestionById(prisma: PrismaClient, id: string) {
  const question = await prisma.question.findUnique({
    where: { id },
    select: QUESTION_SELECT,
  });
  if (!question) throw createHttpError(404, "Question not found");
  return attachImages(prisma, serializeQuestion(question));
}

async function assertActiveAiRubricExists(prisma: PrismaClient, aiRubricId: string) {
  const aiRubric = await prisma.aiRubric.findFirst({
    where: { id: aiRubricId, isActive: true },
    select: { id: true, totalMaxScore: true },
  });
  if (!aiRubric) throw createHttpError(400, `AIRubricID "${aiRubricId}" was not found or is inactive`);
  return aiRubric;
}

function normalizeQuestionMarkingType(rawType: string | undefined | null, questionType: "MCQ" | "ESSAY"): "AUTO" | "AI" | "MANUAL" {
  const normalized = rawType?.trim().toLowerCase();
  if (questionType === "MCQ") return "AUTO";
  if (!normalized) return "AI";
  if (normalized === "ai" || normalized === "ai_rubric" || normalized === "airubric") return "AI";
  if (normalized === "manual") return "MANUAL";
  return "AI";
}

function normalizeWritingType(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  return normalized;
}

async function assertPassageAllowedForQuestion(
  prisma: PrismaClient,
  params: { type: "MCQ" | "ESSAY"; passageId?: string | null; subjectId: string },
) {
  if (!params.passageId) return;
  if (params.type === "ESSAY") {
    throw createHttpError(400, "ESSAY questions must not use a passage");
  }

  const subject = await prisma.subject.findUnique({
    where: { id: params.subjectId },
    select: { name: true },
  });
  if (!subject) throw createHttpError(404, "Subject not found");

  if (!subject.name.toLowerCase().includes("reading")) {
    throw createHttpError(400, "Passages can only be linked to Reading Comprehension MCQ questions");
  }
}

async function findActiveAiRubricScores(prisma: PrismaClient, aiRubricIds: string[]) {
  if (aiRubricIds.length === 0) return new Map<string, number>();

  const aiRubrics = await prisma.aiRubric.findMany({
    where: { id: { in: aiRubricIds }, isActive: true },
    select: { id: true, totalMaxScore: true },
  });

  return new Map(aiRubrics.map((aiRubric) => [aiRubric.id, aiRubric.totalMaxScore]));
}

async function getQuestionIdSeed(prisma: PrismaClient, subjectId: string): Promise<QuestionIdSeed> {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { name: true, questionCode: true },
  });

  if (!subject) {
    throw createHttpError(404, "Subject not found");
  }

  const code = subject.questionCode || subject.name.substring(0, 2).toUpperCase();
  const prefix = `Q-${code}`;

  const matchingQuestions = await prisma.question.findMany({
    where: {
      subjectId,
      questionId: {
        startsWith: prefix,
      },
    },
    select: {
      questionId: true,
    },
  });

  let nextNumber = 1;
  for (const question of matchingQuestions) {
    const value = question.questionId;
    if (!value) continue;

    const parts = value.split("-");
    const lastPart = parts[parts.length - 1];
    const parsed = lastPart ? parseInt(lastPart, 10) : NaN;
    if (!Number.isNaN(parsed)) {
      nextNumber = Math.max(nextNumber, parsed + 1);
    }
  }

  return { prefix, nextNumber };
}

async function generateNextQuestionId(prisma: PrismaClient, subjectId: string) {
  const seed = await getQuestionIdSeed(prisma, subjectId);

  return {
    questionId: `${seed.prefix}-${String(seed.nextNumber).padStart(3, "0")}`,
    prefix: seed.prefix,
    nextNumber: seed.nextNumber,
  };
}

async function assignGeneratedQuestionIds<T extends { resolvedSubjectId: string; questionId?: string | null }>(
  prisma: PrismaClient,
  rows: T[],
) {
  const seedBySubjectId = new Map<string, QuestionIdSeed>();

  for (const row of rows) {
    if (row.questionId && row.questionId.trim()) continue;

    let seed = seedBySubjectId.get(row.resolvedSubjectId);
    if (!seed) {
      seed = await getQuestionIdSeed(prisma, row.resolvedSubjectId);
      seedBySubjectId.set(row.resolvedSubjectId, seed);
    }

    row.questionId = `${seed.prefix}-${String(seed.nextNumber).padStart(3, "0")}`;
    seed.nextNumber += 1;
  }
}

// ── Service functions ─────────────────────────────────────────────────────────

const SEP = "\x1F"; // ASCII Unit Separator — safe delimiter, cannot appear in user content

function normalizeImportKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function questionBankImportKey(row: Pick<InsertableRow, "resolvedSubjectId" | "resolvedTopicId" | "type" | "questionText">) {
  return `${row.resolvedSubjectId}${SEP}${row.resolvedTopicId}${SEP}${row.type}${SEP}${normalizeImportKey(row.questionText)}`;
}

async function findExistingImportDuplicateRows(
  prisma: PrismaClient,
  rows: InsertableRow[],
  creatorId: string,
) {
  const duplicateRowNumbers = new Set<number>();

  if (rows.length > 0) {
    const topicIds = [...new Set(rows.map((row) => row.resolvedTopicId))];
    const existingQuestions = await prisma.question.findMany({
      where: { tutorId: creatorId, topicId: { in: topicIds } },
      select: { subjectId: true, topicId: true, type: true, questionText: true },
    });

    const existingKeys = new Set(
      existingQuestions.map((question) => questionBankImportKey({
        resolvedSubjectId: question.subjectId,
        resolvedTopicId: question.topicId,
        type: question.type,
        questionText: question.questionText,
      })),
    );

    for (const row of rows) {
      if (existingKeys.has(questionBankImportKey(row))) {
        duplicateRowNumbers.add(row.rowNumber);
      }
    }
  }

  return duplicateRowNumbers;
}

async function dropExistingImportDuplicates(
  prisma: PrismaClient,
  rows: InsertableRow[],
  creatorId: string,
  errors?: Array<{ row: number; reason: string }>,
) {
  const duplicateRowNumbers = await findExistingImportDuplicateRows(prisma, rows, creatorId);
  if (duplicateRowNumbers.size === 0) return 0;

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row || !duplicateRowNumbers.has(row.rowNumber)) continue;

    errors?.push({
      row: row.rowNumber,
      reason: `Question already exists for Section "${row.subjectName}", Topic "${row.topicName}", type "${row.type}", and the same QuestionText`,
    });
    rows.splice(i, 1);
  }

  return duplicateRowNumbers.size;
}

export async function getNextQuestionId(prisma: PrismaClient, subjectId: string) {
  return generateNextQuestionId(prisma, subjectId);
}

export async function createQuestion(

  prisma: PrismaClient,
  body: CreateQuestionBody,
  creatorId: string,
) {
  const latexEnabled = body.latexEnabled ?? false;
  const generatedQuestionId = body.questionId?.trim() || (await generateNextQuestionId(prisma, body.subjectId)).questionId;
  // MCQ maxMarks is locked to 1 per design. ESSAY default 20, but can be set
  // freely (or derived from aiRubric.totalMaxScore later in this function).
  let maxMarks = body.type === "MCQ" ? 1 : (body.maxMarks ?? 20);
  if (body.type === "MCQ" && body.maxMarks !== undefined && body.maxMarks !== 1) {
    throw createHttpError(400, "MCQ questions must have maxMarks = 1");
  }
  const imageRefs = (body.imageRefs ?? []).map(normalizeImageFileName).filter(Boolean);
  const markingType = normalizeQuestionMarkingType(body.markingType, body.type);
  const writingType = normalizeWritingType(body.writingType);

  await assertPassageAllowedForQuestion(prisma, {
    type: body.type,
    passageId: body.passageId ?? null,
    subjectId: body.subjectId,
  });

  if (body.type === "ESSAY") {
    if (!writingType) throw createHttpError(400, "WritingType is required for ESSAY questions");
    await assertWritingTypeAllowed(prisma, writingType);
    if (markingType !== "AI" && markingType !== "MANUAL") {
      throw createHttpError(400, "ESSAY questions must use AI or MANUAL marking");
    }
    if (markingType === "AI" && !body.aiRubricId) {
      throw createHttpError(400, "AIRubricID is required for ESSAY questions graded by AI");
    }
  }

  if (body.type === "MCQ" && markingType !== "AUTO") {
    throw createHttpError(400, "MCQ questions must use AUTO marking");
  }

  if (imageRefs.length > 0) {
    const missingRefs = await findMissingImageRefs(prisma, imageRefs);
    if (missingRefs.length > 0) {
      throw createHttpError(400, `ImageRef(s) not found in master images: ${missingRefs.join(", ")}`);
    }
  }

  if (body.type === "ESSAY" && body.aiRubricId) {
    const aiRubric = await assertActiveAiRubricExists(prisma, body.aiRubricId);
    if (body.maxMarks !== undefined && body.maxMarks !== aiRubric.totalMaxScore) {
      throw createHttpError(400, `MaxMarks must match aiRubric totalMaxScore (${aiRubric.totalMaxScore}) for AIRubricID "${body.aiRubricId}"`);
    }
    maxMarks = aiRubric.totalMaxScore;
  }

  const question = await prisma.question.create({
    data: {
      subjectId: body.subjectId,
      topicId: body.topicId,
      passageId: body.passageId ?? null,
      aiRubricId: body.type === "ESSAY" ? (body.aiRubricId ?? null) : null,
      tutorId: creatorId,
      type: body.type,
      difficulty: body.difficulty,
      questionText: body.questionText,
      writingType: body.type === "ESSAY" ? writingType : null,
      promptText: body.type === "ESSAY" ? (body.promptText?.trim() || null) : null,
      markingGuide: body.type === "ESSAY" ? (body.markingGuide?.trim() || null) : null,
      latexEnabled,
      markingType,
      maxMarks,
      isPracticeAllowed: body.type === "ESSAY" ? (body.isPracticeAllowed ?? false) : true,
      options: body.options ?? Prisma.DbNull,
      correctAnswer: body.type === "MCQ" ? (body.correctAnswer ?? "") : "",
      explanation: body.explanation ?? null,
      timeLimitSeconds: body.timeLimitSeconds && body.timeLimitSeconds > 0 ? body.timeLimitSeconds : null,
      imageRefs,
      subtopics: body.subtopics ?? [],
      notes: body.notes ?? null,
      adaptiveTags: body.adaptiveTags ?? [],
      skillTags: body.skillTags ?? [],
      questionId: generatedQuestionId,
      questionNumber: body.questionNumber ?? null,
      status: "DRAFT",
    },
    select: QUESTION_SELECT,
  });

  if (imageRefs.length > 0) {
    await markImagesLinked(prisma, imageRefs);
  }

  return attachImages(prisma, serializeQuestion(question));
}

export async function listQuestions(prisma: PrismaClient, query: ListQuestionsQuery) {
  const { page, limit, search, subjectId, topicId, passageId, type, difficulty, status, hasImage, isPracticeAllowed } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.QuestionWhereInput = {};
  if (search) {
    where.OR = [
      { questionText: { contains: search, mode: "insensitive" } },
      { questionId: { contains: search, mode: "insensitive" } },
    ];
  }
  if (subjectId) where.subjectId = subjectId;
  if (topicId) where.topicId = topicId;
  if (passageId) where.passageId = passageId;
  if (type) where.type = type;
  if (difficulty) where.difficulty = difficulty;
  if (status) where.status = status;
  if (isPracticeAllowed !== undefined) where.isPracticeAllowed = isPracticeAllowed;
  if (hasImage !== undefined) {
    where.imageRefs = hasImage ? { isEmpty: false } : { isEmpty: true };
  }

  const [data, total] = await Promise.all([
    prisma.question.findMany({
      where,
      select: QUESTION_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.question.count({ where }),
  ]);

  return {
    data: await Promise.all(data.map((q) => attachImages(prisma, serializeQuestion(q)))),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getQuestionById(prisma: PrismaClient, id: string) {
  return findQuestionById(prisma, id);
}

export async function updateQuestion(
  prisma: PrismaClient,
  id: string,
  body: UpdateQuestionBody,
) {
  const existing = await findQuestionById(prisma, id);

  if (existing.status === "PUBLISHED") {
    throw createHttpError(400, "Published questions cannot be edited. Reject the question first.");
  }

  const effectiveType = body.type ?? existing.type;
  const effectiveMarkingType = normalizeQuestionMarkingType(body.markingType ?? existing.markingType, effectiveType);
  const effectiveAiRubricId = body.aiRubricId !== undefined ? body.aiRubricId : existing.aiRubricId;
  const effectiveSubjectId = body.subjectId ?? existing.subjectId;
  const effectivePassageId = body.passageId !== undefined ? body.passageId : existing.passageId;
  const effectiveWritingType = body.writingType !== undefined
    ? normalizeWritingType(body.writingType)
    : normalizeWritingType(existing.writingType);

  await assertPassageAllowedForQuestion(prisma, {
    type: effectiveType,
    passageId: effectivePassageId,
    subjectId: effectiveSubjectId,
  });

  if (effectiveType === "MCQ" && body.aiRubricId) {
    throw createHttpError(400, "MCQ questions must not use a aiRubric");
  }

  if (effectiveType === "ESSAY") {
    if (!effectiveWritingType) throw createHttpError(400, "WritingType is required for ESSAY questions");
    await assertWritingTypeAllowed(prisma, effectiveWritingType);
    if (effectiveMarkingType === "AI" && !effectiveAiRubricId) {
      throw createHttpError(400, "AIRubricID is required for ESSAY questions graded by AI");
    }
  }

  if (effectiveType === "ESSAY" && effectiveAiRubricId) {
    const aiRubric = await assertActiveAiRubricExists(prisma, effectiveAiRubricId);
    const effectiveMaxMarks = body.maxMarks ?? (body.aiRubricId !== undefined ? aiRubric.totalMaxScore : existing.maxMarks);
    if (effectiveMaxMarks !== aiRubric.totalMaxScore) {
      throw createHttpError(400, `MaxMarks must match aiRubric totalMaxScore (${aiRubric.totalMaxScore}) for AIRubricID "${effectiveAiRubricId}"`);
    }
    if (body.aiRubricId !== undefined && body.maxMarks === undefined) body.maxMarks = aiRubric.totalMaxScore;
  }

  if (effectiveType === "MCQ" && effectiveMarkingType !== "AUTO") {
    throw createHttpError(400, "MCQ questions must use AUTO marking");
  }

  if (effectiveType === "ESSAY" && effectiveMarkingType === "AUTO") {
    throw createHttpError(400, "ESSAY questions must use AI or MANUAL marking");
  }

  if (body.type === "MCQ" && existing.type !== "MCQ") {
    if (!body.options || !body.correctAnswer) {
      throw createHttpError(400, "When changing type to MCQ, options and correctAnswer must be provided");
    }
  }

  const updateData: Prisma.QuestionUncheckedUpdateInput & { questionNumber?: number | null } = {};
  if (body.subjectId !== undefined) updateData.subjectId = body.subjectId;
  if (body.topicId !== undefined) updateData.topicId = body.topicId;
  if (body.passageId !== undefined) updateData.passageId = body.passageId;
  if (body.aiRubricId !== undefined) updateData.aiRubricId = body.aiRubricId;
  if (body.type !== undefined) updateData.type = body.type;
  if (body.difficulty !== undefined) updateData.difficulty = body.difficulty;
  if (body.questionText !== undefined) updateData.questionText = body.questionText;
  if (body.writingType !== undefined) updateData.writingType = body.writingType ? normalizeWritingType(body.writingType) : null;
  if (body.promptText !== undefined) updateData.promptText = body.promptText?.trim() || null;
  if (body.markingGuide !== undefined) updateData.markingGuide = body.markingGuide?.trim() || null;
  if (body.latexEnabled !== undefined) {
    updateData.latexEnabled = body.latexEnabled;
  }
  if (body.correctAnswer !== undefined) updateData.correctAnswer = effectiveType === "MCQ" ? body.correctAnswer : "";
  if (body.explanation !== undefined) updateData.explanation = body.explanation;
  if (body.timeLimitSeconds !== undefined) {
    updateData.timeLimitSeconds = body.timeLimitSeconds && body.timeLimitSeconds > 0 ? body.timeLimitSeconds : null;
  }
  let nextImageRefs: string[] | undefined;
  if (body.imageRefs !== undefined) {
    nextImageRefs = body.imageRefs.map(normalizeImageFileName).filter(Boolean);
    if (nextImageRefs.length > 0) {
      const missingRefs = await findMissingImageRefs(prisma, nextImageRefs);
      if (missingRefs.length > 0) {
        throw createHttpError(400, `ImageRef(s) not found in master images: ${missingRefs.join(", ")}`);
      }
    }
    updateData.imageRefs = nextImageRefs;
  }
  if (body.subtopics !== undefined) updateData.subtopics = body.subtopics;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.adaptiveTags !== undefined) updateData.adaptiveTags = body.adaptiveTags;
  if (body.skillTags !== undefined) updateData.skillTags = body.skillTags;
  if (body.questionId !== undefined) updateData.questionId = body.questionId;
  if (body.questionNumber !== undefined) updateData.questionNumber = body.questionNumber;
  if (body.markingType !== undefined) updateData.markingType = effectiveMarkingType;
  if (body.maxMarks !== undefined) {
    if (effectiveType === "MCQ" && body.maxMarks !== 1) {
      throw createHttpError(400, "MCQ questions must have maxMarks = 1");
    }
    updateData.maxMarks = body.maxMarks;
  }
  if (effectiveType === "ESSAY" && body.isPracticeAllowed !== undefined) {
    updateData.isPracticeAllowed = body.isPracticeAllowed;
  }
  if (body.type === "ESSAY" && existing.type !== "ESSAY" && body.isPracticeAllowed === undefined) {
    updateData.isPracticeAllowed = false;
  }
  if (body.type !== undefined && body.markingType === undefined) updateData.markingType = body.type === "ESSAY" ? "AI" : "AUTO";
  if (body.type !== undefined && body.maxMarks === undefined) updateData.maxMarks = body.type === "ESSAY" ? 20 : 1;
  // If type changed to MCQ, force maxMarks = 1
  if (body.type === "MCQ") updateData.maxMarks = 1;
  if (effectiveType === "MCQ") {
    updateData.isPracticeAllowed = true;
    updateData.aiRubricId = null;
    updateData.writingType = null;
    updateData.promptText = null;
    updateData.markingGuide = null;
  }

  if (effectiveType === "ESSAY") {
    updateData.options = Prisma.DbNull;
    updateData.correctAnswer = "";
    updateData.passageId = null;
  } else if (body.options !== undefined) {
    updateData.options = body.options;
  }

  const question = await prisma.question.update({
    where: { id },
    data: updateData,
    select: QUESTION_SELECT,
  });

  if (nextImageRefs !== undefined) {
    const removed = existing.imageRefs.filter((r) => !nextImageRefs!.includes(r));
    await refreshImageExpirations(prisma, removed);
    await markImagesLinked(prisma, nextImageRefs);
  }

  return attachImages(prisma, serializeQuestion(question));
}

export async function deleteQuestion(prisma: PrismaClient, id: string, role: string) {
  const question = await prisma.question.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      imageRefs: true,
      _count: {
        select: {
          examQuestions: true,
          answers: true,
          practiceAnswers: true,
        },
      },
    },
  });

  if (!question) throw createHttpError(404, "Question not found");

  if (role === "TUTOR" && question.status !== "DRAFT") {
    throw createHttpError(403, "Tutors can only delete draft questions");
  }

  if (role === "ADMIN" && question.status === "PUBLISHED") {
    throw createHttpError(403, "Published questions cannot be deleted");
  }

  const usageCount =
    question._count.examQuestions + question._count.answers + question._count.practiceAnswers;

  if (usageCount > 0) {
    throw createHttpError(409, "Cannot delete a question that is used in exams or has student answers");
  }

  await prisma.question.delete({ where: { id } });
  await refreshImageExpirations(prisma, question.imageRefs);
}

export async function submitQuestion(prisma: PrismaClient, id: string) {
  const existingQuestion = await findQuestionById(prisma, id);

  if (existingQuestion.status !== "DRAFT") {
    throw createHttpError(400, "Only draft questions can be submitted for review");
  }

  if (existingQuestion.type === "ESSAY") {
    if (!existingQuestion.writingType || !existingQuestion.aiRubricId) {
      throw createHttpError(400, "Essay questions require WritingType and AIRubricID before submitting");
    }
  }

  const updatedQuestion = await prisma.question.update({
    where: { id },
    data: { status: "PENDING_APPROVAL", rejectionNote: null },
    select: QUESTION_SELECT,
  });

  return attachImages(prisma, serializeQuestion(updatedQuestion));
}

export async function bulkSubmitQuestions(prisma: PrismaClient, ids: string[]) {
  const uniqueIds = [...new Set(ids)];

  const questions = await prisma.question.findMany({
    where: { id: { in: uniqueIds } },
    select: QUESTION_SELECT,
  });

  const questionMap = new Map(questions.map((q) => [q.id, q]));

  const eligibleIds: string[] = [];
  const failures: Array<{ id: string; reason: string }> = [];

  for (const id of uniqueIds) {
    const question = questionMap.get(id);
    if (!question) {
      failures.push({ id, reason: "Question not found" });
      continue;
    }
    if (question.status !== "DRAFT") {
      failures.push({ id, reason: "Only draft questions can be submitted for review" });
      continue;
    }
    if (question.type === "ESSAY" && (!question.writingType || !question.aiRubricId)) {
      failures.push({ id, reason: "Essay questions require WritingType and AIRubricID before submitting" });
      continue;
    }
    eligibleIds.push(id);
  }

  if (eligibleIds.length > 0) {
    await prisma.question.updateMany({
      where: { id: { in: eligibleIds } },
      data: { status: "PENDING_APPROVAL", rejectionNote: null },
    });
  }

  return {
    submitted: eligibleIds.length,
    failed: failures.length,
    submittedIds: eligibleIds,
    failures,
  };
}

export async function approveQuestion(prisma: PrismaClient, id: string) {
  const existingQuestion = await findQuestionById(prisma, id);

  if (existingQuestion.status !== "PENDING_APPROVAL") {
    throw createHttpError(400, "Only questions pending approval can be approved");
  }

  const updatedQuestion = await prisma.question.update({
    where: { id },
    data: { status: "PUBLISHED" },
    select: QUESTION_SELECT,
  });

  return attachImages(prisma, serializeQuestion(updatedQuestion));
}

export async function rejectQuestion(
  prisma: PrismaClient,
  id: string,
  rejectionNote: RejectQuestionBody["rejectionNote"],
) {
  const existingQuestion = await findQuestionById(prisma, id);

  if (existingQuestion.status !== "PENDING_APPROVAL" && existingQuestion.status !== "PUBLISHED") {
    throw createHttpError(400, "Only pending or published questions can be rejected");
  }

  const updatedQuestion = await prisma.question.update({
    where: { id },
    data: { status: "DRAFT", rejectionNote },
    select: QUESTION_SELECT,
  });

  return attachImages(prisma, serializeQuestion(updatedQuestion));
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

const DIFFICULTY_MAP: Record<string, string> = {
  easy:   "EASY",
  medium: "MEDIUM",
  hard:   "HARD",
};

const MCQ_VALID_KEYS = ["A", "B", "C", "D", "E"] as const;

function normalizeQuestionType(rawType: string | undefined, hasOptions: boolean): "MCQ" | "ESSAY" | "" {
  const normalized = rawType?.trim().toLowerCase();
  if (!normalized) return hasOptions ? "MCQ" : "ESSAY";
  if (normalized === "mcq") return "MCQ";
  if (normalized === "essay") return "ESSAY";
  return "";
}

function normalizeMarkingType(rawType: string | undefined, questionType: "MCQ" | "ESSAY" | ""): "AUTO" | "AI" | "MANUAL" | "" {
  const normalized = rawType?.trim().toLowerCase();
  if (!normalized) return questionType === "ESSAY" ? "AI" : "AUTO";
  if (normalized === "auto") return "AUTO";
  if (normalized === "ai" || normalized === "ai_rubric" || normalized === "airubric") return "AI";
  if (normalized === "manual") return "MANUAL";
  return "";
}

function parseCsvBoolean(value: string | undefined) {
  const normalized = (value?.trim() || "").toLowerCase();
  return ["true", "1", "yes", "y"].includes(normalized);
}

// Builds the data payload for a single question row (used by both import paths)
function buildQuestionInsertData(
  row: InsertableRow,
  passageExtIdToId: Map<string, string>,
  creatorId: string,
  id: string,
): Prisma.QuestionCreateManyInput {
  const isMcq = row.type === "MCQ";
  const optionsList: Array<{ key: string; text: string }> = [];
  if (isMcq) {
    if (row.optionA) optionsList.push({ key: "A", text: row.optionA });
    if (row.optionB) optionsList.push({ key: "B", text: row.optionB });
    if (row.optionC) optionsList.push({ key: "C", text: row.optionC });
    if (row.optionD) optionsList.push({ key: "D", text: row.optionD });
    if (row.optionE) optionsList.push({ key: "E", text: row.optionE });
  }
  const options: Prisma.InputJsonValue | typeof Prisma.DbNull =
    isMcq && optionsList.length > 0 ? optionsList : Prisma.DbNull;
  const resolvedPassageId = row.passageExternalId
    ? (passageExtIdToId.get(row.passageExternalId) ?? null)
    : null;
  const isLatex = row.latexEnabled ?? false;
  return {
    id,
    questionId:       row.questionId || null,
    questionNumber:   row.questionNumber,
    subjectId:        row.resolvedSubjectId,
    topicId:          row.resolvedTopicId,
    passageId:        resolvedPassageId,
    aiRubricId:         row.type === "ESSAY" ? (row.aiRubricId || null) : null,
    tutorId:          creatorId,
    type:             row.type as "MCQ" | "ESSAY",
    difficulty:       row.difficulty as "EASY" | "MEDIUM" | "HARD",
    questionText:     row.questionText,
    writingType:      row.type === "ESSAY" ? row.writingType : null,
    promptText:       row.type === "ESSAY" ? row.promptText : null,
    markingGuide:     row.type === "ESSAY" ? row.markingGuide : null,
    latexEnabled:    isLatex,
    markingType:      normalizeQuestionMarkingType(row.markingType, row.type as "MCQ" | "ESSAY"),
    maxMarks:         row.maxMarks,
    isPracticeAllowed: isMcq,
    options,
    correctAnswer:    row.type === "MCQ" ? (row.correctAnswer || "") : "",
    explanation:      row.explanation,
    timeLimitSeconds: row.timeLimitSeconds,
    imageRefs:        row.imageRefs ?? [],
    subtopics:        row.subtopics,
    notes:            row.notes,
    adaptiveTags:     row.adaptiveTags ?? [],
    skillTags:        row.skillTags ?? [],
    status:           "DRAFT",
  };
}

// Bulk insert rows and return them with full relations, preserving insertion order.
// Uses createMany (single SQL statement) + findMany to avoid transaction timeouts
// on large imports with remote databases.
async function bulkInsertQuestions(
  prisma: PrismaClient,
  insertableRows: InsertableRow[],
  passageExtIdToId: Map<string, string>,
  creatorId: string,
): Promise<Prisma.QuestionGetPayload<{ select: typeof QUESTION_SELECT }>[]> {
  const ids = insertableRows.map(() => randomUUID());

  await prisma.question.createMany({
    data: insertableRows.map((row, i) =>
      buildQuestionInsertData(row, passageExtIdToId, creatorId, ids[i]!)
    ),
  });

  const byId = new Map(
    (await prisma.question.findMany({
      where: { id: { in: ids } },
      select: QUESTION_SELECT,
    })).map((q) => [q.id, q])
  );

  return ids.map((id) => byId.get(id)!);
}

export async function bulkImportQuestions(
  prisma: PrismaClient,
  buffer: Buffer,
  creatorId: string,
): Promise<BulkImportResult> {
  let rows: CsvRow[];

  try {
    rows = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as CsvRow[];
  } catch {
    throw createHttpError(400, "Failed to parse CSV file. Ensure it is a valid CSV with the correct headers.");
  }

  if (rows.length > 500) {
    throw createHttpError(400, "CSV exceeds maximum of 500 rows");
  }

  const errors: Array<{ row: number; reason: string }> = [];
  const skippedErrors: Array<{ row: number; reason: string }> = [];
  const unresolvedRows: UnresolvedRowItem[] = [];

  const validRows: Array<{ rowNumber: number; row: NormalisedRow }> = [];

  // Pre-fetch allowed writing types once for efficient per-row validation
  const allowedWritingTypes = new Set(
    (await prisma.aiRubricWritingType.findMany({ select: { name: true } })).map((w) => w.name),
  );

  // ── Validation + normalisation pass ──────────────────────────────────────

  for (const [i, raw] of rows.entries()) {
    const rowNumber = i + 2; // +1 for header, +1 for 1-based
    const rowErrors: string[] = [];

    const subjectName = raw.Section?.trim() ?? "";
    const topicName   = raw.Topic?.trim() ?? "";

    const hasOptions = !!(raw.OptionA?.trim());
    const rawQuestionType = raw.QuestionType?.trim() ?? "";
    const questionType = normalizeQuestionType(rawQuestionType, hasOptions);
    const rawMarkingType = raw.MarkingType?.trim() ?? "";
    const markingType = normalizeMarkingType(rawMarkingType, questionType);
    const aiRubricId = raw.AIRubricID?.trim() || null;
    const writingType = normalizeWritingType(raw.WritingType);
    const maxMarksRaw = raw.MaxMarks?.trim();
    // MCQ locked to 1 per design. CSV-provided maxMarks for MCQ is ignored.
    const maxMarks = questionType === "MCQ"
      ? 1
      : (maxMarksRaw ? parseInt(maxMarksRaw, 10) : 20);

    const rawDifficulty = raw.Difficulty?.trim() ?? "";
    const difficulty = DIFFICULTY_MAP[rawDifficulty.toLowerCase()] ?? "";

    const questionText = raw.QuestionText?.trim() || "";
    const promptText = questionType === "ESSAY" ? (raw.PromptText?.trim() || null) : null;
    const correctAnswer = raw.CorrectAnswer?.trim().toUpperCase() ?? "";

    if (!subjectName) rowErrors.push("Section (subject) is required");
    if (!topicName) rowErrors.push("Topic is required");
    if (!questionType) rowErrors.push(`QuestionType "${rawQuestionType}" must be MCQ or Essay`);
    if (!markingType) rowErrors.push(`MarkingType "${rawMarkingType}" must be Auto, AI, or Manual`);
    if (questionType === "MCQ" && aiRubricId) rowErrors.push("AIRubricID must not be provided for MCQ");
    if (questionType === "MCQ" && markingType !== "AUTO") rowErrors.push("MCQ questions must use Auto marking");
    if (questionType === "ESSAY" && markingType === "AUTO") rowErrors.push("Essay questions must use AI or Manual marking");
    if (questionType === "ESSAY" && !writingType) {
      rowErrors.push("WritingType is required for Essay");
    } else if (writingType && !allowedWritingTypes.has(writingType)) {
      rowErrors.push(`WritingType "${writingType}" is not registered. Allowed values: ${[...allowedWritingTypes].join(", ") || "(none — create writing types first)"}`);
    }
    if (questionType === "ESSAY" && markingType === "AI" && !aiRubricId) rowErrors.push("AIRubricID is required for Essay graded by AI");
    if (!Number.isFinite(maxMarks) || maxMarks < 1) rowErrors.push(`MaxMarks "${maxMarksRaw ?? ""}" must be a positive integer`);
    if (!difficulty) rowErrors.push(`Difficulty "${rawDifficulty}" must be Easy, Medium, or Hard`);
    if (!questionText) rowErrors.push("QuestionText is required");

    if (questionType === "MCQ") {
      if (!raw.OptionA?.trim()) rowErrors.push("OptionA is required for MCQ");
      if (!raw.OptionB?.trim()) rowErrors.push("OptionB is required for MCQ");
      if (!raw.OptionC?.trim()) rowErrors.push("OptionC is required for MCQ");
      if (!raw.OptionD?.trim()) rowErrors.push("OptionD is required for MCQ");
      if (!raw.OptionE?.trim()) rowErrors.push("OptionE is required for MCQ");
      if (!correctAnswer) {
        rowErrors.push("CorrectAnswer is required for MCQ");
      } else if (!(MCQ_VALID_KEYS as readonly string[]).includes(correctAnswer)) {
        rowErrors.push(`CorrectAnswer "${correctAnswer}" must be A, B, C, D, or E`);
      }
    }
    if (questionType === "ESSAY" && raw.PassageID?.trim()) {
      rowErrors.push("PassageID must not be provided for Essay questions");
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      continue;
    }

    const normalizedQuestionType = questionType as "MCQ" | "ESSAY";
    const normalizedMarkingType = markingType as "AUTO" | "AI";

    const timeLimitRaw = raw.TimeLimitSeconds?.trim();
    const timeLimitSeconds = timeLimitRaw ? parseInt(timeLimitRaw, 10) || null : null;

    const subtopics = raw.Subtopics?.trim()
      ? raw.Subtopics.split("|").map((s) => s.trim()).filter(Boolean)
      : [];
    // CSV may provide single ImageRef or pipe-separated refs via ImageRef column
    const csvImageRefs = splitImageRefs(raw.ImageRef?.trim() || null)
      .map((ref) => normalizeImageFileName(ref))
      .filter(Boolean);

    const latexEnabled = parseCsvBoolean(raw.LatexEnabled);
    const qnumRaw = raw.QuestionNumber?.trim() ?? "";
    let questionNumber: number | null = null;
    if (qnumRaw) {
      const parsed = parseInt(qnumRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        rowErrors.push(`QuestionNumber "${qnumRaw}" must be a positive integer`);
      } else {
        questionNumber = parsed;
      }
    }
    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      continue;
    }

    validRows.push({
      rowNumber,
      row: {
        questionId:        "", // auto-generated; CSV column ignored
        questionNumber,
        subjectName,
        topicName,
        type:              normalizedQuestionType,
        difficulty,
        questionText,
        writingType:       normalizedQuestionType === "ESSAY" ? writingType : null,
        promptText:        normalizedQuestionType === "ESSAY" ? promptText : null,
        markingGuide:      normalizedQuestionType === "ESSAY" ? (raw.MarkingGuide?.trim() || null) : null,
        optionA:           raw.OptionA?.trim() ?? "",
        optionB:           raw.OptionB?.trim() ?? "",
        optionC:           raw.OptionC?.trim() ?? "",
        optionD:           raw.OptionD?.trim() ?? "",
        optionE:           raw.OptionE?.trim() ?? "",
        correctAnswer:     normalizedQuestionType === "MCQ" ? correctAnswer : "",
        explanation:       raw.Explanation?.trim() || null,
        timeLimitSeconds,
        imageRefs: csvImageRefs,
        passageExternalId: raw.PassageID?.trim() || null,
        aiRubricId,
        subtopics,
        notes:             raw.Notes?.trim() || null,
        latexEnabled,
        adaptiveTags:      raw.AdaptiveTags?.trim()
                             ? raw.AdaptiveTags.split("|").map((s) => s.trim()).filter(Boolean)
                             : [],
        skillTags:         raw.SkillTags?.trim()
                             ? raw.SkillTags.split("|").map((s) => s.trim()).filter(Boolean)
                             : [],
        markingType:       normalizedMarkingType,
        maxMarks,
      },
    });
  }

  if (validRows.length === 0) {
    return { total: rows.length, created: 0, skipped: 0, failed: errors.length, unresolved: 0, errors, skippedErrors, unresolvedRows, createdQuestions: [] };
  }

  const aiRubricIds = [...new Set(validRows.map((r) => r.row.aiRubricId).filter(Boolean) as string[])];
  const aiRubricScoreById = await findActiveAiRubricScores(prisma, aiRubricIds);
  for (let i = validRows.length - 1; i >= 0; i--) {
    const row = validRows[i];
    if (!row) continue;
    const effectiveAiRubricId = row.row.aiRubricId || null;
    if (row.row.type === "MCQ" && effectiveAiRubricId) {
      errors.push({ row: row.rowNumber, reason: `AIRubricID must not be provided for MCQ questions` });
      validRows.splice(i, 1);
    } else if (row.row.type === "ESSAY" && !effectiveAiRubricId) {
      errors.push({ row: row.rowNumber, reason: `AIRubricID is required for Essay questions` });
      validRows.splice(i, 1);
    } else if (effectiveAiRubricId) {
      const aiRubricMaxScore = aiRubricScoreById.get(effectiveAiRubricId);
      if (aiRubricMaxScore === undefined) {
        errors.push({ row: row.rowNumber, reason: `AIRubricID "${effectiveAiRubricId}" was not found or is inactive` });
        validRows.splice(i, 1);
      } else if (row.row.maxMarks !== aiRubricMaxScore) {
        errors.push({ row: row.rowNumber, reason: `MaxMarks must match aiRubric totalMaxScore (${aiRubricMaxScore}) for AIRubricID "${effectiveAiRubricId}"` });
        validRows.splice(i, 1);
      }
    }
  }

  const allRefs = validRows.flatMap((r) => r.row.imageRefs);
  const missingImageRefs = await findMissingImageRefs(prisma, allRefs);
  if (missingImageRefs.length > 0) {
    const missingSet = new Set(missingImageRefs);
    for (let i = validRows.length - 1; i >= 0; i--) {
      const row = validRows[i];
      if (!row) continue;
      const rowMissing = row.row.imageRefs.filter((ref) => missingSet.has(ref));
      if (rowMissing.length > 0) {
        errors.push({ row: row.rowNumber, reason: `ImageRef(s) not found in master images: ${rowMissing.join(", ")}` });
        validRows.splice(i, 1);
      }
    }
  }

  if (validRows.length === 0) {
    return { total: rows.length, created: 0, skipped: 0, failed: errors.length, unresolved: 0, errors, skippedErrors, unresolvedRows, createdQuestions: [] };
  }

  // ── Subject / Topic resolution ────────────────────────────────────────────

  const uniqueSubjectNames = [...new Set(validRows.map((r) => r.row.subjectName))];

  const foundSubjects = await prisma.subject.findMany({
    where: { name: { in: uniqueSubjectNames } },
    select: { id: true, name: true },
  });

  const subjectNameToId = new Map(foundSubjects.map((s) => [s.name, s.id]));

  const topicLookupPairs: Array<{ subjectId: string; topicName: string }> = [];
  for (const { row } of validRows) {
    const subjectId = subjectNameToId.get(row.subjectName);
    if (subjectId) topicLookupPairs.push({ subjectId, topicName: row.topicName });
  }

  const uniqueTopicPairs = [...new Map(
    topicLookupPairs.map((p) => [`${p.subjectId}|${p.topicName}`, p])
  ).values()];

  const foundTopics = uniqueTopicPairs.length > 0
    ? await prisma.topic.findMany({
        where: { OR: uniqueTopicPairs.map((p) => ({ subjectId: p.subjectId, name: p.topicName })) },
        select: { id: true, subjectId: true, name: true },
      })
    : [];

  const topicKeyToId = new Map(foundTopics.map((t) => [`${t.subjectId}|${t.name}`, t.id]));

  // ── Passage resolution ────────────────────────────────────────────────────

  const uniquePassageIds = [...new Set(
    validRows.map((r) => r.row.passageExternalId).filter(Boolean) as string[]
  )];

  const foundPassages = uniquePassageIds.length > 0
    ? await prisma.passage.findMany({
        where: { passageId: { in: uniquePassageIds } },
        select: { id: true, passageId: true },
      })
    : [];

  const passageExtIdToId = new Map(foundPassages.map((p) => [p.passageId!, p.id]));

  // ── Build insertable list ─────────────────────────────────────────────────

  const insertableRows: InsertableRow[] = [];

  for (const { rowNumber, row } of validRows) {
    const resolvedSubjectId = subjectNameToId.get(row.subjectName);
    if (!resolvedSubjectId) {
      unresolvedRows.push({
        rowNumber,
        sectionName: row.subjectName,
        topicName: row.topicName,
        reason: "SUBJECT_NOT_FOUND",
        rowData: row,
      });
      continue;
    }

    const resolvedTopicId = topicKeyToId.get(`${resolvedSubjectId}|${row.topicName}`);
    if (!resolvedTopicId) {
      unresolvedRows.push({
        rowNumber,
        sectionName: row.subjectName,
        topicName: row.topicName,
        reason: "TOPIC_NOT_FOUND",
        rowData: row,
      });
      continue;
    }

    if (row.passageExternalId && !passageExtIdToId.has(row.passageExternalId)) {
      errors.push({ row: rowNumber, reason: `PassageID "${row.passageExternalId}" was not found` });
      continue;
    }

    insertableRows.push({ ...row, rowNumber, resolvedSubjectId, resolvedTopicId });
  }

  if (insertableRows.length === 0) {
    return { total: rows.length, created: 0, skipped: 0, failed: errors.length, unresolved: unresolvedRows.length, errors, skippedErrors, unresolvedRows, createdQuestions: [] };
  }

  await assignGeneratedQuestionIds(prisma, insertableRows);

  // ── Detect duplicate question-bank content inside the same CSV ─────────────

  {
    const seen = new Map<string, number>(); // key -> first rowNumber
    const dupRowNumbers = new Set<number>();
    for (const row of insertableRows) {
      const key = questionBankImportKey(row);
      const first = seen.get(key);
      if (first !== undefined) {
        dupRowNumbers.add(row.rowNumber);
        errors.push({
          row: row.rowNumber,
          reason: `Duplicate question content for the same subject, topic, and type (also at row ${first})`,
        });
      } else {
        seen.set(key, row.rowNumber);
      }
    }
    if (dupRowNumbers.size > 0) {
      // Drop duplicates from insertable list so a clean import proceeds
      for (let i = insertableRows.length - 1; i >= 0; i--) {
        const r = insertableRows[i];
        if (r && dupRowNumbers.has(r.rowNumber)) {
          insertableRows.splice(i, 1);
        }
      }
    }
  }

  await dropExistingImportDuplicates(prisma, insertableRows, creatorId, skippedErrors);

  if (insertableRows.length === 0) {
    return { total: rows.length, created: 0, skipped: 0, failed: errors.length, unresolved: unresolvedRows.length, errors, skippedErrors, unresolvedRows, createdQuestions: [] };
  }

  // ── Bulk insert questions ─────────────────────────────────────────────────

  const createdQuestions = await bulkInsertQuestions(
    prisma, insertableRows, passageExtIdToId, creatorId,
  );
  await markImagesLinked(prisma, insertableRows.flatMap((row) => row.imageRefs));

  const createdQuestionsWithRowNumbers = await Promise.all(
    insertableRows.map(async (row, idx) => ({
      rowNumber: row.rowNumber,
      question: await attachImages(prisma, serializeQuestion(createdQuestions[idx]!)),
    }))
  );

  const created = insertableRows.length;

  return {
    total: rows.length,
    created,
    skipped: skippedErrors.length,
    failed: errors.length,
    unresolved: unresolvedRows.length,
    errors,
    skippedErrors,
    unresolvedRows,
    createdQuestions: createdQuestionsWithRowNumbers,
  };
}

export async function resolveAndSavePendingRows(
  prisma: PrismaClient,
  unresolvedRows: ResolveImportBody["rows"],
  creatorId: string,
): Promise<{ saved: number; stillUnresolved: UnresolvedRowItem[]; createdQuestions: Array<{ rowNumber: number; question: ReturnType<typeof serializeQuestion> }> }> {
  if (unresolvedRows.length === 0) return { saved: 0, stillUnresolved: [], createdQuestions: [] };

  const unresolvedRowsByName = unresolvedRows.filter((r) => !r.resolvedSubjectId);

  // Re-resolve subject/topic by name (they may have been created since the import)
  const uniqueSubjectNames = [...new Set(unresolvedRowsByName.map((r) => r.rowData.subjectName))];

  const foundSubjects = await prisma.subject.findMany({
    where: { name: { in: uniqueSubjectNames } },
    select: { id: true, name: true },
  });

  const subjectNameToId = new Map(foundSubjects.map((s) => [s.name, s.id]));

  const topicLookupPairs: Array<{ subjectId: string; topicName: string }> = [];
  for (const row of unresolvedRowsByName) {
    const subjectId = subjectNameToId.get(row.rowData.subjectName);
    if (subjectId) topicLookupPairs.push({ subjectId, topicName: row.rowData.topicName });
  }

  const uniqueTopicPairs = [...new Map(
    topicLookupPairs.map((p) => [`${p.subjectId}|${p.topicName}`, p])
  ).values()];

  const foundTopics = uniqueTopicPairs.length > 0
    ? await prisma.topic.findMany({
        where: { OR: uniqueTopicPairs.map((p) => ({ subjectId: p.subjectId, name: p.topicName })) },
        select: { id: true, subjectId: true, name: true },
      })
    : [];

  const topicKeyToId = new Map(foundTopics.map((t) => [`${t.subjectId}|${t.name}`, t.id]));

  const insertableRows: InsertableRow[] = [];
  const stillUnresolved: UnresolvedRowItem[] = [];

  for (const ur of unresolvedRows) {
    const resolvedSubjectId = ur.resolvedSubjectId ?? subjectNameToId.get(ur.rowData.subjectName);
    if (!resolvedSubjectId) {
      stillUnresolved.push({ ...ur, reason: "SUBJECT_NOT_FOUND" });
      continue;
    }
    const resolvedTopicId = ur.resolvedTopicId ?? topicKeyToId.get(`${resolvedSubjectId}|${ur.rowData.topicName}`);
    if (!resolvedTopicId) {
      stillUnresolved.push({ ...ur, reason: "TOPIC_NOT_FOUND" });
      continue;
    }
    insertableRows.push({
      ...ur.rowData,
      latexEnabled: ur.rowData.latexEnabled ?? false,
      rowNumber: ur.rowNumber,
      resolvedSubjectId,
      resolvedTopicId,
    });
  }

  if (insertableRows.length === 0) {
    return { saved: 0, stillUnresolved, createdQuestions: [] };
  }

  const aiRubricIds = [...new Set(insertableRows.map((row) => row.aiRubricId).filter(Boolean) as string[])];
  const aiRubricScoreById = await findActiveAiRubricScores(prisma, aiRubricIds);
  const aiRubricIssues: string[] = [];
  const resolveAllowedWritingTypes = new Set(
    (await prisma.aiRubricWritingType.findMany({ select: { name: true } })).map((w) => w.name),
  );

  for (const row of insertableRows) {
    const rowType = row.type === "ESSAY" ? "ESSAY" : "MCQ";
    row.type = rowType;
    row.markingType = normalizeQuestionMarkingType(row.markingType, rowType);
    row.writingType = rowType === "ESSAY" ? normalizeWritingType(row.writingType) : null;
    if (rowType === "ESSAY") {
      row.correctAnswer = "";
    }

    if (rowType === "MCQ" && row.markingType !== "AUTO") {
      aiRubricIssues.push(`row ${row.rowNumber}: MCQ questions must use Auto marking`);
      continue;
    }

    if (rowType === "MCQ" && row.aiRubricId) {
      aiRubricIssues.push(`row ${row.rowNumber}: AIRubricID must not be provided for MCQ`);
      continue;
    }

    if (rowType === "ESSAY" && row.markingType !== "AI" && row.markingType !== "MANUAL") {
      aiRubricIssues.push(`row ${row.rowNumber}: Essay questions must use AI or Manual marking`);
      continue;
    }

    if (rowType === "ESSAY" && !row.writingType) {
      aiRubricIssues.push(`row ${row.rowNumber}: WritingType is required for Essay`);
      continue;
    }

    if (rowType === "ESSAY" && row.writingType && !resolveAllowedWritingTypes.has(row.writingType)) {
      aiRubricIssues.push(`row ${row.rowNumber}: WritingType "${row.writingType}" is not registered`);
      continue;
    }

    if (rowType === "ESSAY" && row.passageExternalId) {
      aiRubricIssues.push(`row ${row.rowNumber}: PassageID must not be provided for Essay questions`);
      continue;
    }

    if (rowType === "ESSAY" && row.markingType === "AI" && !row.aiRubricId) {
      aiRubricIssues.push(`row ${row.rowNumber}: AIRubricID is required for Essay graded by AI`);
      continue;
    }

    if (!row.aiRubricId) continue;

    const aiRubricMaxScore = aiRubricScoreById.get(row.aiRubricId);
    if (aiRubricMaxScore === undefined) {
      aiRubricIssues.push(`row ${row.rowNumber}: AIRubricID "${row.aiRubricId}" was not found or is inactive`);
    } else if (row.maxMarks !== aiRubricMaxScore) {
      aiRubricIssues.push(`row ${row.rowNumber}: MaxMarks must match aiRubric totalMaxScore (${aiRubricMaxScore}) for AIRubricID "${row.aiRubricId}"`);
    }
  }

  if (aiRubricIssues.length > 0) {
    const shownIssues = aiRubricIssues.slice(0, 5).join("; ");
    const extraCount = aiRubricIssues.length > 5 ? `; and ${aiRubricIssues.length - 5} more` : "";
    throw createHttpError(400, `Cannot save resolved import rows. ${shownIssues}${extraCount}`);
  }

  const missingImageRefs = await findMissingImageRefs(prisma, insertableRows.flatMap((row) => row.imageRefs));
  if (missingImageRefs.length > 0) {
    throw createHttpError(400, `Cannot save resolved import rows. Missing ImageRef: ${missingImageRefs.slice(0, 5).join(", ")}${missingImageRefs.length > 5 ? "; and more" : ""}`);
  }

  await dropExistingImportDuplicates(prisma, insertableRows, creatorId);

  if (insertableRows.length === 0) {
    return { saved: 0, stillUnresolved, createdQuestions: [] };
  }

  await assignGeneratedQuestionIds(prisma, insertableRows);

  // Passage resolution
  const uniquePassageIds = [...new Set(
    insertableRows.map((r) => r.passageExternalId).filter(Boolean) as string[]
  )];

  const foundPassages = uniquePassageIds.length > 0
    ? await prisma.passage.findMany({
        where: { passageId: { in: uniquePassageIds } },
        select: { id: true, passageId: true },
      })
    : [];

  const passageExtIdToId = new Map(foundPassages.map((p) => [p.passageId!, p.id]));

  const missingPassageIds = uniquePassageIds.filter((extId) => !passageExtIdToId.has(extId));
  if (missingPassageIds.length > 0) {
    throw createHttpError(400, `Cannot save resolved import rows. Missing PassageID: ${missingPassageIds.slice(0, 5).join(", ")}${missingPassageIds.length > 5 ? "; and more" : ""}`);
  }

  // Bulk insert questions
  const createdQuestions = await bulkInsertQuestions(
    prisma, insertableRows, passageExtIdToId, creatorId,
  );
  await markImagesLinked(prisma, insertableRows.flatMap((row) => row.imageRefs));

  const createdQuestionsWithRowNumbers = await Promise.all(
    insertableRows.map(async (row, idx) => ({
      rowNumber: row.rowNumber,
      question: await attachImages(prisma, serializeQuestion(createdQuestions[idx]!)),
    }))
  );

  return { saved: insertableRows.length, stillUnresolved, createdQuestions: createdQuestionsWithRowNumbers };
}
