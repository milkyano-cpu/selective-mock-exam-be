import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  bulkImportQuestions,
  resolveAndSavePendingRows,
  uploadQuestionImage,
} from "../../src/modules/questions/questions.service.js";
import type { ResolveImportBody, UnresolvedRowData } from "../../src/modules/questions/questions.schema.js";

const CREATOR_ID = "creator-1";
const SUBJECT_ID = "subject-vr";
const TOPIC_ID = "topic-analogies";
const EXAM_ID = "exam-1";

type AnyRecord = Record<string, any>;

const CSV_HEADERS = [
  "TestName",
  "Section",
  "QuestionNumber",
  "QuestionText",
  "OptionA",
  "OptionB",
  "OptionC",
  "OptionD",
  "OptionE",
  "CorrectAnswer",
  "Explanation",
  "Difficulty",
  "Topic",
  "Subtopics",
  "TimeLimitSeconds",
  "ImageURL",
  "PassageID",
  "PassageText",
  "Notes",
  "QuestionType",
  "MarkingType",
  "MaxMarks",
  "AIRubricID",
] as const;

const DEFAULT_CSV_ROW: Record<(typeof CSV_HEADERS)[number], string> = {
  TestName: "Selective Entry 1",
  Section: "Verbal Reasoning",
  QuestionNumber: "1",
  QuestionText: "Complete the analogy.",
  OptionA: "A",
  OptionB: "B",
  OptionC: "C",
  OptionD: "D",
  OptionE: "E",
  CorrectAnswer: "A",
  Explanation: "Because A is correct.",
  Difficulty: "Easy",
  Topic: "Analogies",
  Subtopics: "",
  TimeLimitSeconds: "",
  ImageURL: "",
  PassageID: "",
  PassageText: "",
  Notes: "",
  QuestionType: "MCQ",
  MarkingType: "Auto",
  MaxMarks: "1",
  AIRubricID: "",
};

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvBuffer(rows: Array<Partial<Record<(typeof CSV_HEADERS)[number], string | number | null>>>) {
  const lines = [
    CSV_HEADERS.join(","),
    ...rows.map((row) =>
      CSV_HEADERS.map((header) => csvEscape(row[header] ?? DEFAULT_CSV_ROW[header])).join(",")
    ),
  ];

  return Buffer.from(lines.join("\n"));
}

function mockQuestionRecord(overrides: AnyRecord = {}) {
  const now = new Date("2026-05-08T00:00:00.000Z");
  return {
    id: "question-1",
    questionId: "Q-VR-001",
    questionNumber: 1,
    subjectId: SUBJECT_ID,
    topicId: TOPIC_ID,
    tutorId: CREATOR_ID,
    passageId: null,
    aiRubricId: null,
    type: "MCQ",
    difficulty: "EASY",
    questionText: "Complete the analogy.",
    options: [
      { key: "A", text: "A" },
      { key: "B", text: "B" },
      { key: "C", text: "C" },
      { key: "D", text: "D" },
      { key: "E", text: "E" },
    ],
    correctAnswer: "A",
    explanation: "Because A is correct.",
    timeLimitSeconds: null,
    imageUrl: null,
    imageUrls: [],
    subtopics: [],
    notes: null,
    latexEnabled: false,
    markingType: "AUTO",
    maxMarks: 1,
    status: "DRAFT",
    rejectionNote: null,
    createdAt: now,
    updatedAt: now,
    subject: { name: "Verbal Reasoning" },
    topic: { name: "Analogies" },
    aiRubric: null,
    ...overrides,
  };
}

function mockPendingRow(overrides: Partial<UnresolvedRowData> = {}): ResolveImportBody["rows"][number] {
  const rowData: UnresolvedRowData = {
    questionId: "",
    testName: "Selective Entry 1",
    questionNumber: 1,
    subjectName: "Verbal Reasoning",
    topicName: "Analogies",
    type: "MCQ",
    difficulty: "EASY",
    questionText: "Complete the analogy.",
    optionA: "A",
    optionB: "B",
    optionC: "C",
    optionD: "D",
    optionE: "E",
    correctAnswer: "A",
    explanation: null,
    timeLimitSeconds: null,
    imageUrl: null,
    imageUrls: [],
    passageExternalId: null,
    passageText: null,
    aiRubricId: null,
    subtopics: [],
    notes: null,
    latexEnabled: false,
    markingType: "AUTO",
    maxMarks: 1,
    ...overrides,
  };

  return {
    rowNumber: 4,
    sectionName: rowData.subjectName,
    topicName: rowData.topicName,
    reason: "TOPIC_NOT_FOUND",
    resolvedSubjectId: SUBJECT_ID,
    resolvedTopicId: TOPIC_ID,
    rowData,
  };
}

function mockPrisma(overrides: AnyRecord = {}) {
  const insertedQuestions: AnyRecord[] = [];
  const subjects = overrides.subjects ?? [{ id: SUBJECT_ID, name: "Verbal Reasoning" }];
  const topics = overrides.topics ?? [{ id: TOPIC_ID, subjectId: SUBJECT_ID, name: "Analogies" }];
  const existingExams = overrides.existingExams ?? [];
  const existingExamQuestions = overrides.existingExamQuestions ?? [];
  const existingStandaloneQuestions = overrides.existingStandaloneQuestions ?? [];
  const aiRubrics = overrides.aiRubrics ?? [];
  const questionById = overrides.questionById ?? mockQuestionRecord();

  const prisma = {
    subject: {
      findMany: jest.fn(async () => subjects),
      findUnique: jest.fn(async () => ({ name: "Verbal Reasoning", questionCode: "VR" })),
    },
    topic: {
      findMany: jest.fn(async () => topics),
    },
    passage: {
      findMany: jest.fn(async () => []),
      update: jest.fn(async (args: AnyRecord) => args.data),
      create: jest.fn(async (args: AnyRecord) => ({
        id: `passage-${args.data.externalId}`,
        externalId: args.data.externalId,
      })),
    },
    aiRubric: {
      findMany: jest.fn(async () => aiRubrics),
      findFirst: jest.fn(async () => aiRubrics[0] ?? null),
    },
    question: {
      findUnique: jest.fn(async () => questionById),
      create: jest.fn(async (args: AnyRecord) => mockQuestionRecord(args.data)),
      createMany: jest.fn(async (args: { data: AnyRecord[] }) => {
        for (const data of args.data) {
          insertedQuestions.push(mockQuestionRecord({
            ...data,
            subject: { name: data.subjectId === SUBJECT_ID ? "Verbal Reasoning" : "Unknown" },
            topic: { name: data.topicId === TOPIC_ID ? "Analogies" : "Unknown" },
          }));
        }
        return { count: args.data.length };
      }),
      findMany: jest.fn(async (args: AnyRecord = {}) => {
        if (args.where?.id?.in) {
          return args.where.id.in.map((id: string) =>
            insertedQuestions.find((question) => question.id === id) ?? mockQuestionRecord({ id })
          );
        }

        if (args.where?.subjectId && args.where?.questionId?.startsWith) {
          return [];
        }

        if (args.where?.tutorId && args.where?.topicId?.in) {
          return existingStandaloneQuestions;
        }

        return [];
      }),
      update: jest.fn(async (args: AnyRecord) => mockQuestionRecord({
        ...questionById,
        ...args.data,
      })),
    },
    exam: {
      findMany: jest.fn(async () => existingExams),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: EXAM_ID })),
    },
    examQuestion: {
      findMany: jest.fn(async () => existingExamQuestions),
      createMany: jest.fn(async (args: { data: AnyRecord[] }) => ({ count: args.data.length })),
    },
  };

  for (const key of ["subject", "topic", "passage", "aiRubric", "question", "exam", "examQuestion"]) {
    if (overrides[key]) {
      prisma[key as keyof typeof prisma] = {
        ...prisma[key as keyof typeof prisma],
        ...overrides[key],
      } as never;
    }
  }

  return prisma;
}

describe("questions.service import and image upload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("uploadQuestionImage", () => {
    it("replaces the first pending placeholder and preserves image order", async () => {
      const prisma = mockPrisma({
        questionById: mockQuestionRecord({
          imageUrl: "01.png",
          imageUrls: ["https://cdn.example.com/existing.png", "01.png", "02.png"],
        }),
      });

      const result = await uploadQuestionImage(prisma as never, "question-1", "https://cdn.example.com/01.png");

      expect(prisma.question.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "question-1" },
        data: {
          imageUrl: "https://cdn.example.com/existing.png",
          imageUrls: ["https://cdn.example.com/existing.png", "https://cdn.example.com/01.png", "02.png"],
        },
      }));
      expect(result.imageUrl).toBe("https://cdn.example.com/existing.png");
      expect(result.imageUrls).toEqual(["https://cdn.example.com/existing.png", "https://cdn.example.com/01.png", "02.png"]);
    });

    it("updates imageUrl to the first item when the first placeholder is replaced", async () => {
      const prisma = mockPrisma({
        questionById: mockQuestionRecord({
          imageUrl: "01.png",
          imageUrls: ["01.png", "02.png"],
        }),
      });

      const result = await uploadQuestionImage(prisma as never, "question-1", "https://cdn.example.com/01.png");

      expect(prisma.question.update).toHaveBeenCalledWith(expect.objectContaining({
        data: {
          imageUrl: "https://cdn.example.com/01.png",
          imageUrls: ["https://cdn.example.com/01.png", "02.png"],
        },
      }));
      expect(result.imageUrl).toBe("https://cdn.example.com/01.png");
    });

    it("rejects published questions", async () => {
      const prisma = mockPrisma({
        questionById: mockQuestionRecord({ status: "PUBLISHED", imageUrls: ["01.png"] }),
      });

      await expect(uploadQuestionImage(prisma as never, "question-1", "https://cdn.example.com/01.png"))
        .rejects.toMatchObject({ statusCode: 400 });
      expect(prisma.question.update).not.toHaveBeenCalled();
    });

    it("rejects upload when no pending placeholder remains", async () => {
      const prisma = mockPrisma({
        questionById: mockQuestionRecord({
          imageUrl: "https://cdn.example.com/01.png",
          imageUrls: ["https://cdn.example.com/01.png"],
        }),
      });

      await expect(uploadQuestionImage(prisma as never, "question-1", "https://cdn.example.com/02.png"))
        .rejects.toMatchObject({
          statusCode: 400,
          message: "This question does not need any more images",
        });
      expect(prisma.question.update).not.toHaveBeenCalled();
    });
  });

  describe("bulkImportQuestions", () => {
    it("creates a valid MCQ question and exam link", async () => {
      const prisma = mockPrisma();

      const result = await bulkImportQuestions(prisma as never, csvBuffer([{}]), CREATOR_ID);

      expect(result).toMatchObject({ total: 1, created: 1, skipped: 0, failed: 0, unresolved: 0 });
      expect(prisma.question.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: [expect.objectContaining({
          subjectId: SUBJECT_ID,
          topicId: TOPIC_ID,
          type: "MCQ",
          aiRubricId: null,
          tutorId: CREATOR_ID,
        })],
      }));
      expect(prisma.exam.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ title: "Selective Entry 1", createdBy: CREATOR_ID }),
      }));
      expect(prisma.examQuestion.createMany).toHaveBeenCalledWith({
        data: [{ examId: EXAM_ID, questionId: expect.any(String), order: 1 }],
        skipDuplicates: true,
      });
    });

    it("skips an already imported TestName, Subject, and QuestionNumber without creating duplicates", async () => {
      const prisma = mockPrisma({
        existingExams: [{ id: EXAM_ID, title: "Selective Entry 1" }],
        existingExamQuestions: [{ examId: EXAM_ID, order: 1, question: { subjectId: SUBJECT_ID } }],
      });

      const result = await bulkImportQuestions(prisma as never, csvBuffer([{}]), CREATOR_ID);

      expect(result.created).toBe(0);
      expect(result.skippedErrors).toHaveLength(1);
      expect(result.skippedErrors).toEqual([
        expect.objectContaining({ row: 2, reason: expect.stringContaining("Question already exists") }),
      ]);
      expect(prisma.question.create).not.toHaveBeenCalled();
      expect(prisma.question.createMany).not.toHaveBeenCalled();
      expect(prisma.examQuestion.createMany).not.toHaveBeenCalled();
    });

    it("skips duplicate rows inside the same CSV with a validation error", async () => {
      const prisma = mockPrisma();

      const result = await bulkImportQuestions(prisma as never, csvBuffer([{}, { QuestionText: "Duplicate row" }]), CREATOR_ID);

      expect(result).toMatchObject({ total: 2, created: 1, failed: 1 });
      expect(result.errors).toEqual([
        expect.objectContaining({
          row: 3,
          reason: expect.stringContaining("Duplicate QuestionNumber 1"),
        }),
      ]);
      expect(prisma.question.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: [expect.objectContaining({ questionNumber: 1 })],
      }));
    });

    it("returns a validation error for MCQ rows that provide AIRubricID", async () => {
      const prisma = mockPrisma();

      const result = await bulkImportQuestions(prisma as never, csvBuffer([{ AIRubricID: "aiRubric-missing" }]), CREATOR_ID);

      expect(result).toMatchObject({ total: 1, created: 0, failed: 1 });
      expect(result.errors).toEqual([
        expect.objectContaining({
          row: 2,
          reason: expect.stringContaining("AIRubricID must not be provided for MCQ"),
        }),
      ]);
      expect(prisma.question.createMany).not.toHaveBeenCalled();
    });

    it("returns unresolved rows when subject or topic is missing", async () => {
      const prisma = mockPrisma({ topics: [] });

      const result = await bulkImportQuestions(prisma as never, csvBuffer([{}]), CREATOR_ID);

      expect(result).toMatchObject({ total: 1, created: 0, failed: 0, unresolved: 1 });
      expect(result.unresolvedRows).toEqual([
        expect.objectContaining({
          rowNumber: 2,
          sectionName: "Verbal Reasoning",
          topicName: "Analogies",
          reason: "TOPIC_NOT_FOUND",
        }),
      ]);
      expect(prisma.question.createMany).not.toHaveBeenCalled();
    });
  });

  describe("resolveAndSavePendingRows", () => {
    it("saves a pending row once subject and topic are resolved", async () => {
      const prisma = mockPrisma();

      const result = await resolveAndSavePendingRows(prisma as never, [mockPendingRow()], CREATOR_ID);

      expect(result).toMatchObject({ saved: 1, stillUnresolved: [] });
      expect(prisma.question.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: [expect.objectContaining({
          subjectId: SUBJECT_ID,
          topicId: TOPIC_ID,
          type: "MCQ",
        })],
      }));
      expect(prisma.examQuestion.createMany).toHaveBeenCalledWith({
        data: [{ examId: EXAM_ID, questionId: expect.any(String), order: 1 }],
        skipDuplicates: true,
      });
    });

    it("rejects invalid aiRubric ids during resolve with a clear 400", async () => {
      const prisma = mockPrisma();
      const row = mockPendingRow({
        type: "ESSAY",
        markingType: "AI_RUBRIC",
        aiRubricId: "aiRubric-missing",
        maxMarks: 20,
        correctAnswer: "",
      });

      await expect(resolveAndSavePendingRows(prisma as never, [row], CREATOR_ID))
        .rejects.toMatchObject({
          statusCode: 400,
          message: expect.stringContaining('AIRubricID "aiRubric-missing" was not found or is inactive'),
        });
      expect(prisma.question.createMany).not.toHaveBeenCalled();
    });

    it("does not create a new question for existing duplicates during resolve", async () => {
      const prisma = mockPrisma({
        existingExams: [{ id: EXAM_ID, title: "Selective Entry 1" }],
        existingExamQuestions: [{ examId: EXAM_ID, order: 1, question: { subjectId: SUBJECT_ID } }],
      });

      const result = await resolveAndSavePendingRows(prisma as never, [mockPendingRow()], CREATOR_ID);

      expect(result).toEqual({ saved: 0, stillUnresolved: [], createdQuestions: [] });
      expect(prisma.question.create).not.toHaveBeenCalled();
      expect(prisma.question.createMany).not.toHaveBeenCalled();
      expect(prisma.examQuestion.createMany).not.toHaveBeenCalled();
    });

    it("returns saved 0 when all pending rows are duplicates", async () => {
      const prisma = mockPrisma({
        existingExams: [{ id: EXAM_ID, title: "Selective Entry 1" }],
        existingExamQuestions: [
          { examId: EXAM_ID, order: 1, question: { subjectId: SUBJECT_ID } },
          { examId: EXAM_ID, order: 2, question: { subjectId: SUBJECT_ID } },
        ],
      });

      const rows = [
        mockPendingRow(),
        mockPendingRow({ questionNumber: 2, questionText: "Second duplicate." }),
      ];

      const result = await resolveAndSavePendingRows(prisma as never, rows, CREATOR_ID);

      expect(result.saved).toBe(0);
      expect(result.createdQuestions).toEqual([]);
      expect(prisma.question.createMany).not.toHaveBeenCalled();
    });
  });
});
