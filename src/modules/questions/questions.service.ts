import { randomUUID } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { createHttpError } from "../../utils/http-error.js";
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
  options: true,
  correctAnswer: true,
  explanation: true,
  timeLimitSeconds: true,
  imageUrl: true,
  imageUrls: true,
  subtopics: true,
  notes: true,
  latexEnabled: true,
  adaptiveTags: true,
  skillTags: true,
  markingType: true,
  maxMarks: true,
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

function serializeQuestion(question: QuestionRecord) {
  const { subject, topic, aiRubric, ...rest } = question;

  return {
    ...rest,
    subjectName: subject.name,
    topicName: topic.name,
    aiRubric,
  };
}

function splitImageRefs(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isUploadedImageRef(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function hasPendingImageRef(question: { imageUrl: string | null; imageUrls: string[] }) {
  const refs = question.imageUrls.length > 0
    ? question.imageUrls
    : splitImageRefs(question.imageUrl);

  return refs.some((ref) => !isUploadedImageRef(ref));
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
  TestName: string;
  Section: string;
  QuestionNumber: string;
  QuestionText: string;
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
  return serializeQuestion(question);
}

async function assertActiveAiRubricExists(prisma: PrismaClient, aiRubricId: string) {
  const aiRubric = await prisma.aiRubric.findFirst({
    where: { id: aiRubricId, isActive: true },
    select: { id: true, totalMaxScore: true },
  });
  if (!aiRubric) throw createHttpError(400, `AIRubricID "${aiRubricId}" was not found or is inactive`);
  return aiRubric;
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

function examImportKey(testName: string, subjectId: string, questionNumber: number) {
  return `${normalizeImportKey(testName)}${SEP}${subjectId}${SEP}${questionNumber}`;
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

  const examRows = rows.filter((row) => row.testName && row.questionNumber != null);
  // Normalize testNames for case-insensitive lookup; keep a map back to original DB titles
  const rawTestNames = [...new Set(examRows.map((row) => row.testName!).filter(Boolean))];

  if (rawTestNames.length > 0) {
    const existingExams = await prisma.exam.findMany({
      where: { createdBy: creatorId, title: { in: rawTestNames, mode: "insensitive" } },
      select: { id: true, title: true },
    });

    const examIdToTitle = new Map(existingExams.map((exam) => [exam.id, exam.title]));
    const examIds = existingExams.map((exam) => exam.id);
    const questionNumbers = [...new Set(
      examRows.map((row) => row.questionNumber).filter((value): value is number => value != null)
    )];

    if (examIds.length > 0 && questionNumbers.length > 0) {
      const existingExamQuestions = await prisma.examQuestion.findMany({
        where: {
          examId: { in: examIds },
          order: { in: questionNumbers },
        },
        select: {
          examId: true,
          order: true,
          question: {
            select: { subjectId: true },
          },
        },
      });

      const existingExamKeys = new Set(
        existingExamQuestions.flatMap((examQuestion) => {
          const title = examIdToTitle.get(examQuestion.examId);
          return title ? [examImportKey(title, examQuestion.question.subjectId, examQuestion.order)] : [];
        }),
      );

      for (const row of examRows) {
        if (row.testName && row.questionNumber != null && existingExamKeys.has(examImportKey(row.testName, row.resolvedSubjectId, row.questionNumber))) {
          duplicateRowNumbers.add(row.rowNumber);
        }
      }
    }
  }

  const standaloneRows = rows.filter((row) => !row.testName);
  if (standaloneRows.length > 0) {
    // Collect the distinct topicIds from the import to scope the DB query
    const topicIds = [...new Set(standaloneRows.map((row) => row.resolvedTopicId))];

    // Query by tutorId + topicId only — no wide OR clause, filter questionText in memory
    const existingQuestions = await prisma.question.findMany({
      where: { tutorId: creatorId, topicId: { in: topicIds } },
      select: { subjectId: true, topicId: true, type: true, questionText: true },
    });

    const existingStandaloneKeys = new Set(
      existingQuestions.map((question) => questionBankImportKey({
        resolvedSubjectId: question.subjectId,
        resolvedTopicId: question.topicId,
        type: question.type,
        questionText: question.questionText,
      })),
    );

    for (const row of standaloneRows) {
      if (existingStandaloneKeys.has(questionBankImportKey(row))) {
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
      reason: row.testName && row.questionNumber != null
        ? `Question already exists for TestName "${row.testName}", Section "${row.subjectName}", QuestionNumber ${row.questionNumber}`
        : `Question already exists for Section "${row.subjectName}", Topic "${row.topicName}", and the same QuestionText`,
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
  let maxMarks = body.maxMarks ?? (body.type === "ESSAY" ? 20 : 1);

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
      latexEnabled,
      markingType: body.markingType ?? (body.type === "ESSAY" ? "AI_RUBRIC" : "AUTO"),
      maxMarks,
      options: body.options ?? Prisma.DbNull,
      correctAnswer: body.correctAnswer ?? "",
      explanation: body.explanation ?? null,
      timeLimitSeconds: body.timeLimitSeconds ?? null,
      imageUrl: body.imageUrls?.[0] ?? body.imageUrl ?? null,
      imageUrls: body.imageUrls ?? splitImageRefs(body.imageUrl),
      subtopics: body.subtopics ?? [],
      notes: body.notes ?? null,
      adaptiveTags: body.adaptiveTags ?? null,
      skillTags: body.skillTags ?? null,
      questionId: generatedQuestionId,
      questionNumber: body.questionNumber ?? null,
      status: "DRAFT",
    },
    select: QUESTION_SELECT,
  });

  return serializeQuestion(question);
}

export async function listQuestions(prisma: PrismaClient, query: ListQuestionsQuery) {
  const { page, limit, search, subjectId, topicId, passageId, type, difficulty, status, hasImage } = query;
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
  if (hasImage !== undefined) {
    where.OR = hasImage
      ? [{ imageUrl: { not: null } }, { imageUrls: { isEmpty: false } }]
      : [{ imageUrl: null }, { imageUrls: { isEmpty: true } }];
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
    data: data.map(serializeQuestion),
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
  const effectiveMarkingType = body.markingType ?? existing.markingType;
  const effectiveAiRubricId = body.aiRubricId !== undefined ? body.aiRubricId : existing.aiRubricId;

  if (effectiveType === "MCQ" && body.aiRubricId) {
    throw createHttpError(400, "MCQ questions must not use a aiRubric");
  }

  if (effectiveType === "ESSAY" && effectiveAiRubricId) {
    const aiRubric = await assertActiveAiRubricExists(prisma, effectiveAiRubricId);
    const effectiveMaxMarks = body.maxMarks ?? (body.aiRubricId !== undefined ? aiRubric.totalMaxScore : existing.maxMarks);
    if (effectiveMaxMarks !== aiRubric.totalMaxScore) {
      throw createHttpError(400, `MaxMarks must match aiRubric totalMaxScore (${aiRubric.totalMaxScore}) for AIRubricID "${effectiveAiRubricId}"`);
    }
    if (body.aiRubricId !== undefined && body.maxMarks === undefined) body.maxMarks = aiRubric.totalMaxScore;
  }

  if (effectiveType === "MCQ" && effectiveMarkingType === "AI_RUBRIC") {
    throw createHttpError(400, "MCQ questions must use AUTO marking");
  }

  if (effectiveType === "ESSAY" && effectiveMarkingType === "AUTO") {
    throw createHttpError(400, "ESSAY questions must use AI_RUBRIC marking");
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
  if (body.latexEnabled !== undefined) {
    updateData.latexEnabled = body.latexEnabled;
  }
  if (body.correctAnswer !== undefined) updateData.correctAnswer = body.correctAnswer;
  if (body.explanation !== undefined) updateData.explanation = body.explanation;
  if (body.timeLimitSeconds !== undefined) updateData.timeLimitSeconds = body.timeLimitSeconds;
  if (body.imageUrl !== undefined) {
    updateData.imageUrl = body.imageUrl;
    updateData.imageUrls = splitImageRefs(body.imageUrl);
  }
  if (body.imageUrls !== undefined) {
    updateData.imageUrls = body.imageUrls;
    updateData.imageUrl = body.imageUrls[0] ?? null;
  }
  if (body.subtopics !== undefined) updateData.subtopics = body.subtopics;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.adaptiveTags !== undefined) updateData.adaptiveTags = body.adaptiveTags;
  if (body.skillTags !== undefined) updateData.skillTags = body.skillTags;
  if (body.questionId !== undefined) updateData.questionId = body.questionId;
  if (body.questionNumber !== undefined) updateData.questionNumber = body.questionNumber;
  if (body.markingType !== undefined) updateData.markingType = body.markingType;
  if (body.maxMarks !== undefined) updateData.maxMarks = body.maxMarks;
  if (body.type !== undefined && body.markingType === undefined) updateData.markingType = body.type === "ESSAY" ? "AI_RUBRIC" : "AUTO";
  if (body.type !== undefined && body.maxMarks === undefined) updateData.maxMarks = body.type === "ESSAY" ? 20 : 1;
  if (effectiveType === "MCQ") updateData.aiRubricId = null;

  if (effectiveType === "ESSAY") {
    updateData.options = Prisma.DbNull;
  } else if (body.options !== undefined) {
    updateData.options = body.options;
  }

  const question = await prisma.question.update({
    where: { id },
    data: updateData,
    select: QUESTION_SELECT,
  });

  return serializeQuestion(question);
}

export async function deleteQuestion(prisma: PrismaClient, id: string, role: string) {
  const question = await prisma.question.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
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
}

export async function submitQuestion(prisma: PrismaClient, id: string) {
  const existingQuestion = await findQuestionById(prisma, id);

  if (existingQuestion.status !== "DRAFT") {
    throw createHttpError(400, "Only draft questions can be submitted for review");
  }

  if (hasPendingImageRef(existingQuestion)) {
    throw createHttpError(400, "Please upload all required images for this question before submitting");
  }

  const updatedQuestion = await prisma.question.update({
    where: { id },
    data: { status: "PENDING_APPROVAL", rejectionNote: null },
    select: QUESTION_SELECT,
  });

  return serializeQuestion(updatedQuestion);
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
    if (hasPendingImageRef(question)) {
      failures.push({ id, reason: "Please upload all required images before submitting" });
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

  return serializeQuestion(updatedQuestion);
}

export async function rejectQuestion(
  prisma: PrismaClient,
  id: string,
  rejectionNote: RejectQuestionBody["rejectionNote"],
) {
  const existingQuestion = await findQuestionById(prisma, id);

  if (existingQuestion.status !== "PENDING_APPROVAL") {
    throw createHttpError(400, "Only questions pending approval can be rejected");
  }

  const updatedQuestion = await prisma.question.update({
    where: { id },
    data: { status: "DRAFT", rejectionNote },
    select: QUESTION_SELECT,
  });

  return serializeQuestion(updatedQuestion);
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

function normalizeMarkingType(rawType: string | undefined, questionType: "MCQ" | "ESSAY" | ""): "AUTO" | "AI_RUBRIC" | "" {
  const normalized = rawType?.trim().toLowerCase();
  if (!normalized) return questionType === "ESSAY" ? "AI_RUBRIC" : "AUTO";
  if (normalized === "auto") return "AUTO";
  if (normalized === "ai_rubric" || normalized === "airubric") return "AI_RUBRIC";
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
    latexEnabled:    isLatex,
    markingType:      row.markingType,
    maxMarks:         row.maxMarks,
    options,
    correctAnswer:    row.correctAnswer || "",
    explanation:      row.explanation,
    timeLimitSeconds: row.timeLimitSeconds,
    imageUrl:         row.imageUrls[0] ?? row.imageUrl,
    imageUrls:        row.imageUrls,
    subtopics:        row.subtopics,
    notes:            row.notes,
    adaptiveTags:     row.adaptiveTags ?? null,
    skillTags:        row.skillTags ?? null,
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
    const maxMarksRaw = raw.MaxMarks?.trim();
    const maxMarks = maxMarksRaw ? parseInt(maxMarksRaw, 10) : questionType === "ESSAY" ? 20 : 1;

    const rawDifficulty = raw.Difficulty?.trim() ?? "";
    const difficulty = DIFFICULTY_MAP[rawDifficulty.toLowerCase()] ?? "";

    const questionText = raw.QuestionText?.trim() ?? "";
    const correctAnswer = raw.CorrectAnswer?.trim().toUpperCase() ?? "";

    if (!subjectName) rowErrors.push("Section (subject) is required");
    if (!topicName) rowErrors.push("Topic is required");
    if (!questionType) rowErrors.push(`QuestionType "${rawQuestionType}" must be MCQ or Essay`);
    if (!markingType) rowErrors.push(`MarkingType "${rawMarkingType}" must be Auto or AI_Rubric`);
    if (questionType === "MCQ" && aiRubricId) rowErrors.push("AIRubricID must not be provided for MCQ");
    if (questionType === "MCQ" && markingType === "AI_RUBRIC") rowErrors.push("MCQ questions must use Auto marking");
    if (questionType === "ESSAY" && markingType === "AUTO") rowErrors.push("Essay questions must use AI_RUBRIC marking");
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

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      continue;
    }

    const normalizedQuestionType = questionType as "MCQ" | "ESSAY";
    const normalizedMarkingType = markingType as "AUTO" | "AI_RUBRIC";

    const timeLimitRaw = raw.TimeLimitSeconds?.trim();
    const timeLimitSeconds = timeLimitRaw ? parseInt(timeLimitRaw, 10) || null : null;

    const subtopics = raw.Subtopics?.trim()
      ? raw.Subtopics.split("|").map((s) => s.trim()).filter(Boolean)
      : [];

    const latexEnabled = parseCsvBoolean(raw.LatexEnabled);
    const testName = raw.TestName?.trim() || null;
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
    if (testName && questionNumber === null) {
      rowErrors.push("QuestionNumber is required when TestName is provided");
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, reason: rowErrors.join("; ") });
      continue;
    }

    validRows.push({
      rowNumber,
      row: {
        questionId:        "", // auto-generated; CSV column ignored
        testName,
        questionNumber,
        subjectName,
        topicName,
        type:              normalizedQuestionType,
        difficulty,
        questionText,
        optionA:           raw.OptionA?.trim() ?? "",
        optionB:           raw.OptionB?.trim() ?? "",
        optionC:           raw.OptionC?.trim() ?? "",
        optionD:           raw.OptionD?.trim() ?? "",
        optionE:           raw.OptionE?.trim() ?? "",
        correctAnswer:     normalizedQuestionType === "MCQ" ? correctAnswer : "",
        explanation:       raw.Explanation?.trim() || null,
        timeLimitSeconds,
        imageUrl:          splitImageRefs(raw.ImageURL?.trim() || null)[0] ?? null,
        imageUrls:         splitImageRefs(raw.ImageURL?.trim() || null),
        passageExternalId: raw.PassageID?.trim() || null,
        aiRubricId,
        subtopics,
        notes:             raw.Notes?.trim() || null,
        latexEnabled,
        adaptiveTags:      raw.AdaptiveTags?.trim() || null,
        skillTags:         raw.SkillTags?.trim() || null,
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
        where: { externalId: { in: uniquePassageIds } },
        select: { id: true, externalId: true },
      })
    : [];

  const passageExtIdToId = new Map(foundPassages.map((p) => [p.externalId!, p.id]));

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

  // ── Detect duplicate (TestName, QuestionNumber) pairs ─────────────────────

  {
    const seen = new Map<string, number>(); // key -> first rowNumber
    const dupRowNumbers = new Set<number>();
    for (const row of insertableRows) {
      if (!row.testName || row.questionNumber == null) continue;
      const key = `${row.testName}|${row.resolvedSubjectId}|${row.questionNumber}`;
      const first = seen.get(key);
      if (first !== undefined) {
        dupRowNumbers.add(row.rowNumber);
        errors.push({
          row: row.rowNumber,
          reason: `Duplicate QuestionNumber ${row.questionNumber} for TestName "${row.testName}" in the same subject (also at row ${first})`,
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

  const createdQuestionsWithRowNumbers = insertableRows.map((row, idx) => ({
    rowNumber: row.rowNumber,
    question: serializeQuestion(createdQuestions[idx]!),
  }));

  // ── Upsert Exams from TestName + create ExamQuestion links ────────────────

  const examRows = insertableRows
    .map((row, idx) => ({ row, questionId: createdQuestions[idx]?.id }))
    .filter((r): r is { row: InsertableRow; questionId: string } =>
      Boolean(r.questionId && r.row.testName && r.row.questionNumber != null),
    );

  if (examRows.length > 0) {
    // Group rows by testName to determine examType/gradingType per exam
    const byTestName = new Map<string, typeof examRows>();
    for (const r of examRows) {
      const key = r.row.testName!;
      if (!byTestName.has(key)) byTestName.set(key, []);
      byTestName.get(key)!.push(r);
    }

    // Find or create Exam per testName
    const testNameToExamId = new Map<string, string>();
    for (const [testName, group] of byTestName.entries()) {
      const existing = await prisma.exam.findFirst({
        where: { title: testName, createdBy: creatorId },
        select: { id: true },
      });

      if (existing) {
        testNameToExamId.set(testName, existing.id);
      } else {
        const types = new Set(group.map((g) => g.row.type));
        const gradingType: "AUTO" | "MANUAL" =
          types.has("MCQ") ? "AUTO" : "MANUAL";

        const created = await prisma.exam.create({
          data: {
            title:           testName,
            examType:        "MOCK_EXAM",
            durationMinutes: null,
            gradingType,
            createdBy:       creatorId,
          },
          select: { id: true },
        });
        testNameToExamId.set(testName, created.id);
      }
    }

    // Bulk-create ExamQuestion links (skipDuplicates handles re-imports)
    const examQuestionData = examRows.map((r) => ({
      examId:     testNameToExamId.get(r.row.testName!)!,
      questionId: r.questionId,
      order:      r.row.questionNumber!,
    }));

    if (examQuestionData.length > 0) {
      await prisma.examQuestion.createMany({
        data: examQuestionData,
        skipDuplicates: true,
      });
    }
  }

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

  for (const row of insertableRows) {
    if (row.type === "MCQ" && row.aiRubricId) {
      aiRubricIssues.push(`row ${row.rowNumber}: AIRubricID must not be provided for MCQ`);
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
        where: { externalId: { in: uniquePassageIds } },
        select: { id: true, externalId: true },
      })
    : [];

  const passageExtIdToId = new Map(foundPassages.map((p) => [p.externalId!, p.id]));

  const missingPassageIds = uniquePassageIds.filter((extId) => !passageExtIdToId.has(extId));
  if (missingPassageIds.length > 0) {
    throw createHttpError(400, `Cannot save resolved import rows. Missing PassageID: ${missingPassageIds.slice(0, 5).join(", ")}${missingPassageIds.length > 5 ? "; and more" : ""}`);
  }

  // Bulk insert questions
  const createdQuestions = await bulkInsertQuestions(
    prisma, insertableRows, passageExtIdToId, creatorId,
  );

  const createdQuestionsWithRowNumbers = insertableRows.map((row, idx) => ({
    rowNumber: row.rowNumber,
    question: serializeQuestion(createdQuestions[idx]!),
  }));

  // Exam linking
  const examRows = insertableRows
    .map((row, idx) => ({ row, questionId: createdQuestions[idx]?.id }))
    .filter((r): r is { row: InsertableRow; questionId: string } =>
      Boolean(r.questionId && r.row.testName && r.row.questionNumber != null),
    );

  if (examRows.length > 0) {
    const byTestName = new Map<string, typeof examRows>();
    for (const r of examRows) {
      const key = r.row.testName!;
      if (!byTestName.has(key)) byTestName.set(key, []);
      byTestName.get(key)!.push(r);
    }

    const testNameToExamId = new Map<string, string>();
    for (const [testName, group] of byTestName.entries()) {
      const existing = await prisma.exam.findFirst({
        where: { title: testName, createdBy: creatorId },
        select: { id: true },
      });

      if (existing) {
        testNameToExamId.set(testName, existing.id);
      } else {
        const types = new Set(group.map((g) => g.row.type));
        const gradingType: "AUTO" | "MANUAL" =
          types.has("MCQ") ? "AUTO" : "MANUAL";

        const created = await prisma.exam.create({
          data: {
            title:           testName,
            examType:        "MOCK_EXAM",
            durationMinutes: null,
            gradingType,
            createdBy:       creatorId,
          },
          select: { id: true },
        });
        testNameToExamId.set(testName, created.id);
      }
    }

    const examQuestionData = examRows.map((r) => ({
      examId:     testNameToExamId.get(r.row.testName!)!,
      questionId: r.questionId,
      order:      r.row.questionNumber!,
    }));

    if (examQuestionData.length > 0) {
      await prisma.examQuestion.createMany({
        data: examQuestionData,
        skipDuplicates: true,
      });
    }
  }

  return { saved: insertableRows.length, stillUnresolved, createdQuestions: createdQuestionsWithRowNumbers };
}

export async function uploadQuestionImage(
  prisma: PrismaClient,
  id: string,
  imageUrl: string,
) {
  const existingQuestion = await findQuestionById(prisma, id);

  if (existingQuestion.status === "PUBLISHED") {
    throw createHttpError(400, "Cannot update image of a published question");
  }

  const currentImageUrls = existingQuestion.imageUrls.length > 0
    ? existingQuestion.imageUrls
    : splitImageRefs(existingQuestion.imageUrl);
  const pendingIndex = currentImageUrls.findIndex((ref) => !isUploadedImageRef(ref));
  const nextImageUrls = [...currentImageUrls];

  if (pendingIndex >= 0) {
    nextImageUrls[pendingIndex] = imageUrl;
  } else {
    throw createHttpError(400, "This question does not need any more images");
  }

  const updatedQuestion = await prisma.question.update({
    where: { id },
    data: {
      imageUrl: nextImageUrls[0] ?? null,
      imageUrls: nextImageUrls,
    },
    select: QUESTION_SELECT,
  });

  return serializeQuestion(updatedQuestion);
}
