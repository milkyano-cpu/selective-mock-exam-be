import type { PrismaClient } from "@prisma/client";
import type {
  CreateSubjectInput,
  EnsureSubjectTopicsInput,
  UpdateSubjectInput,
  ListSubjectsQuery,
  CreateTopicInput,
  UpdateTopicInput,
  ListTopicsQuery,
} from "./subjects.schema.js";
import { createHttpError } from "../../utils/http-error.js";
import { isUniqueConstraintError } from "../../utils/prisma-errors.js";

// ── Subject SELECT shapes ───────────────────────────────────

const SUBJECT_SELECT = {
  id: true,
  name: true,
  questionCode: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

const TOPIC_SELECT = {
  id: true,
  subjectId: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

const normalizeTopicName = (name: string) => name.trim().toLocaleLowerCase();

// ── Subject CRUD ────────────────────────────────────────────

export async function listSubjects(
  prisma: PrismaClient,
  query: ListSubjectsQuery
) {
  const { page, limit, search, sortBy, order, publishedOnly, practiceOnly } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [subjects, total] = await Promise.all([
    prisma.subject.findMany({
      where,
      select: {
        ...SUBJECT_SELECT,
        _count: {
          select: {
            topics: true,
            questions: publishedOnly || practiceOnly
              ? { where: { ...(publishedOnly ? { status: "PUBLISHED" as const } : {}), ...(practiceOnly ? { isPracticeAllowed: true } : {}) } }
              : true,
          },
        },
      },
      orderBy: { [sortBy]: order },
      skip,
      take: limit,
    }),
    prisma.subject.count({ where }),
  ]);

  return {
    data: subjects,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getSubjectById(prisma: PrismaClient, id: string) {
  const subject = await prisma.subject.findUnique({
    where: { id },
    select: {
      ...SUBJECT_SELECT,
      topics: {
        select: TOPIC_SELECT,
        orderBy: { name: "asc" },
      },
      _count: { select: { questions: true } },
    },
  });

  if (!subject) {
    throw createHttpError(404, "Subject not found");
  }

  return subject;
}

export async function createSubject(
  prisma: PrismaClient,
  input: CreateSubjectInput
) {
  try {
    return await prisma.subject.create({
      data: {
        name: input.name.trim(),
        questionCode: input.questionCode.trim().toUpperCase(),
        description: input.description ?? null,
      },
      select: SUBJECT_SELECT,
    });
  } catch (error: any) {
    if (isUniqueConstraintError(error)) {
      if (error.message?.includes("question_code")) {
        throw createHttpError(409, "A subject with this question code already exists");
      }
      throw createHttpError(409, "A subject with this name already exists");
    }
    throw error;
  }
}

export async function ensureSubjectWithTopics(
  prisma: PrismaClient,
  input: EnsureSubjectTopicsInput
) {
  const subjectName = input.subject.name.trim();
  const questionCode = input.subject.questionCode.trim().toUpperCase();
  const topicInputs = [...new Map(
    (input.topics ?? [])
      .map((topic) => ({
        name: topic.name.trim(),
        description: topic.description ?? null,
      }))
      .filter((topic) => topic.name.length > 0)
      .map((topic) => [normalizeTopicName(topic.name), topic])
  ).values()];

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.subject.createMany({
        data: [{
          name: subjectName,
          questionCode,
          description: input.subject.description ?? null,
        }],
        skipDuplicates: true,
      });

      const subject = await tx.subject.findUnique({
        where: { name: subjectName },
        select: SUBJECT_SELECT,
      });

      if (!subject) {
        throw createHttpError(409, "A subject with this question code already exists");
      }

      const existingTopics = topicInputs.length > 0
        ? await tx.topic.findMany({
            where: {
              subjectId: subject.id,
              OR: topicInputs.map((topic) => ({
                name: { equals: topic.name, mode: "insensitive" },
              })),
            },
            select: TOPIC_SELECT,
          })
        : [];
      const existingTopicKeys = new Set(existingTopics.map((topic) => normalizeTopicName(topic.name)));
      const topicsToCreate = topicInputs.filter((topic) => !existingTopicKeys.has(normalizeTopicName(topic.name)));

      if (topicsToCreate.length > 0) {
        await tx.topic.createMany({
          data: topicsToCreate.map((topic) => ({
            subjectId: subject.id,
            name: topic.name,
            description: topic.description,
          })),
          skipDuplicates: true,
        });
      }

      const topicsByName = topicInputs.length > 0
        ? await tx.topic.findMany({
            where: {
              subjectId: subject.id,
              OR: topicInputs.map((topic) => ({
                name: { equals: topic.name, mode: "insensitive" },
              })),
            },
            select: TOPIC_SELECT,
          })
        : [];
      const topicMap = new Map(topicsByName.map((topic) => [normalizeTopicName(topic.name), topic]));
      const topics = topicInputs.flatMap((topic) => {
        const createdTopic = topicMap.get(normalizeTopicName(topic.name));
        return createdTopic ? [createdTopic] : [];
      });

      return { subject, topics };
    });
  } catch (error: any) {
    if (isUniqueConstraintError(error)) {
      if (error.message?.includes("question_code")) {
        throw createHttpError(409, "A subject with this question code already exists");
      }
      throw createHttpError(409, "A subject or topic with the same name already exists");
    }
    throw error;
  }
}

export async function updateSubject(
  prisma: PrismaClient,
  id: string,
  input: UpdateSubjectInput
) {
  await assertSubjectExists(prisma, id);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.questionCode !== undefined) data.questionCode = input.questionCode.trim().toUpperCase();
  if (input.description !== undefined) data.description = input.description;

  if (Object.keys(data).length === 0) {
    throw createHttpError(400, "No fields to update");
  }

  try {
    return await prisma.subject.update({
      where: { id },
      data,
      select: SUBJECT_SELECT,
    });
  } catch (error: any) {
    if (isUniqueConstraintError(error)) {
      if (error.message?.includes("question_code")) {
        throw createHttpError(409, "A subject with this question code already exists");
      }
      throw createHttpError(409, "A subject with this name already exists");
    }
    throw error;
  }
}

export async function deleteSubject(prisma: PrismaClient, id: string) {
  const subject = await prisma.subject.findUnique({
    where: { id },
    select: {
      id: true,
      _count: { select: { topics: true, questions: true } },
    },
  });

  if (!subject) {
    throw createHttpError(404, "Subject not found");
  }

  if (subject._count.topics > 0 || subject._count.questions > 0) {
    throw createHttpError(
      409,
      `Cannot delete subject: it has ${subject._count.topics} topic(s) and ${subject._count.questions} question(s). Remove them first.`
    );
  }

  await prisma.subject.delete({ where: { id } });
}

// ── Topic CRUD ──────────────────────────────────────────────

export async function listTopics(
  prisma: PrismaClient,
  subjectId: string,
  query: ListTopicsQuery
) {
  await assertSubjectExists(prisma, subjectId);

  const { page, limit, search, sortBy, order, publishedOnly, practiceOnly } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { subjectId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [topics, total] = await Promise.all([
    prisma.topic.findMany({
      where,
      select: {
        ...TOPIC_SELECT,
        _count: {
          select: {
            questions: publishedOnly || practiceOnly
              ? { where: { ...(publishedOnly ? { status: "PUBLISHED" as const } : {}), ...(practiceOnly ? { isPracticeAllowed: true } : {}) } }
              : true,
          },
        },
      },
      orderBy: { [sortBy]: order },
      skip,
      take: limit,
    }),
    prisma.topic.count({ where }),
  ]);

  return {
    data: topics,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getTopicById(
  prisma: PrismaClient,
  subjectId: string,
  topicId: string
) {
  await assertSubjectExists(prisma, subjectId);

  const topic = await prisma.topic.findFirst({
    where: { id: topicId, subjectId },
    select: {
      ...TOPIC_SELECT,
      _count: { select: { questions: true } },
    },
  });

  if (!topic) {
    throw createHttpError(404, "Topic not found");
  }

  return topic;
}

export async function createTopic(
  prisma: PrismaClient,
  subjectId: string,
  input: CreateTopicInput
) {
  await assertSubjectExists(prisma, subjectId);

  try {
    return await prisma.topic.create({
      data: {
        subjectId,
        name: input.name.trim(),
        description: input.description ?? null,
      },
      select: TOPIC_SELECT,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "A topic with this name already exists in this subject");
    }
    throw error;
  }
}

export async function updateTopic(
  prisma: PrismaClient,
  subjectId: string,
  topicId: string,
  input: UpdateTopicInput
) {
  await assertSubjectExists(prisma, subjectId);
  await assertTopicBelongsToSubject(prisma, subjectId, topicId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description;

  if (Object.keys(data).length === 0) {
    throw createHttpError(400, "No fields to update");
  }

  try {
    return await prisma.topic.update({
      where: { id: topicId },
      data,
      select: TOPIC_SELECT,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "A topic with this name already exists in this subject");
    }
    throw error;
  }
}

export async function deleteTopic(
  prisma: PrismaClient,
  subjectId: string,
  topicId: string
) {
  await assertSubjectExists(prisma, subjectId);

  const topic = await prisma.topic.findFirst({
    where: { id: topicId, subjectId },
    select: {
      id: true,
      _count: { select: { questions: true } },
    },
  });

  if (!topic) {
    throw createHttpError(404, "Topic not found");
  }

  if (topic._count.questions > 0) {
    throw createHttpError(
      409,
      `Cannot delete topic: it has ${topic._count.questions} question(s). Remove them first.`
    );
  }

  await prisma.topic.delete({ where: { id: topicId } });
}

// ── Helpers ─────────────────────────────────────────────────

async function assertSubjectExists(prisma: PrismaClient, id: string) {
  const subject = await prisma.subject.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!subject) {
    throw createHttpError(404, "Subject not found");
  }
}

async function assertTopicBelongsToSubject(
  prisma: PrismaClient,
  subjectId: string,
  topicId: string
) {
  const topic = await prisma.topic.findFirst({
    where: { id: topicId, subjectId },
    select: { id: true },
  });

  if (!topic) {
    throw createHttpError(404, "Topic not found in this subject");
  }
}
