import { Prisma } from "@prisma/client";
import { describe, expect, it, jest } from "@jest/globals";
import {
  createSubject,
  createTopic,
  deleteSubject,
  deleteTopic,
  ensureSubjectWithTopics,
  getSubjectById,
  getTopicById,
  listSubjects,
  listTopics,
  updateSubject,
  updateTopic,
} from "../../src/modules/subjects/subjects.service.js";
import * as subjectsController from "../../src/modules/subjects/subjects.controller.js";

const now = new Date("2026-05-08T00:00:00.000Z");

function subject(overrides: Record<string, unknown> = {}) {
  return {
    id: "subject-vr",
    name: "Verbal Reasoning",
    questionCode: "VR",
    description: "Language and logic",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function topic(overrides: Record<string, unknown> = {}) {
  return {
    id: "topic-analogies",
    subjectId: "subject-vr",
    name: "Analogies",
    description: "Compare relationships",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function uniqueError(message = "Unique constraint failed") {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["name"] },
  });
}

function createTx() {
  return {
    subject: {
      createMany: jest.fn(async () => ({ count: 1 })),
      findUnique: jest.fn(async () => subject()),
    },
    topic: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([topic()] as never),
      createMany: jest.fn(async () => ({ count: 1 })),
    },
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const tx = createTx();
  return {
    tx,
    $transaction: jest.fn(async (callback: (txArg: typeof tx) => unknown) => callback(tx)),
    subject: {
      findMany: jest.fn(async () => [subject({ _count: { topics: 1, questions: 2 } })]),
      count: jest.fn(async () => 1),
      findUnique: jest.fn(async () => subject()),
      create: jest.fn(async () => subject()),
      update: jest.fn(async () => subject({ name: "Updated Subject" })),
      delete: jest.fn(async () => subject()),
    },
    topic: {
      findMany: jest.fn(async () => [topic({ _count: { questions: 2 } })]),
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => topic()),
      create: jest.fn(async () => topic()),
      update: jest.fn(async () => topic({ name: "Updated Topic" })),
      delete: jest.fn(async () => topic()),
    },
    ...overrides,
  };
}

function mockReply() {
  const reply = {
    status: jest.fn<(code: number) => typeof reply>(),
    send: jest.fn<(payload: unknown) => unknown>(),
  };
  reply.status.mockReturnValue(reply);
  reply.send.mockImplementation((payload) => payload);
  return reply;
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    query: { page: 1, limit: 10, sortBy: "name", order: "asc", publishedOnly: false },
    params: { subjectId: "subject-vr", topicId: "topic-analogies" },
    body: {
      name: " Verbal Reasoning ",
      questionCode: " vr ",
      description: "Language and logic",
    },
    user: { sub: "admin-1", role: "ADMIN" },
    server: { prisma: mockPrisma() },
    log: { info: jest.fn() },
    ...overrides,
  };
}

describe("subjects module", () => {
  it("lists subjects with search, pagination, sorting, and published question count", async () => {
    const prisma = mockPrisma();

    const result = await listSubjects(prisma as never, {
      page: 2,
      limit: 5,
      search: "verbal",
      sortBy: "name",
      order: "desc",
      publishedOnly: true,
    });

    expect(prisma.subject.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: "verbal", mode: "insensitive" } },
          { description: { contains: "verbal", mode: "insensitive" } },
        ],
      },
      select: expect.objectContaining({
        _count: { select: { topics: true, questions: { where: { status: "PUBLISHED" } } } },
      }),
      orderBy: { name: "desc" },
      skip: 5,
      take: 5,
    });
    expect(result.meta).toEqual({ page: 2, limit: 5, total: 1, totalPages: 1 });
  });

  it("gets a subject by id and rejects missing subjects", async () => {
    const prisma = mockPrisma();

    await expect(getSubjectById(prisma as never, "subject-vr")).resolves.toEqual(subject());

    const missing = mockPrisma({
      subject: { ...mockPrisma().subject, findUnique: jest.fn(async () => null) },
    });
    await expect(getSubjectById(missing as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Subject not found",
    });
  });

  it("creates and updates subjects with normalized question codes", async () => {
    const prisma = mockPrisma();

    await createSubject(prisma as never, {
      name: " Mathematics ",
      questionCode: " math ",
      description: undefined,
    });

    expect(prisma.subject.create).toHaveBeenCalledWith({
      data: { name: "Mathematics", questionCode: "MATH", description: null },
      select: expect.any(Object),
    });

    await updateSubject(prisma as never, "subject-vr", {
      name: " Updated Subject ",
      questionCode: " us ",
      description: null,
    });

    expect(prisma.subject.update).toHaveBeenCalledWith({
      where: { id: "subject-vr" },
      data: { name: "Updated Subject", questionCode: "US", description: null },
      select: expect.any(Object),
    });
  });

  it("maps subject unique constraint errors and empty updates to clear http errors", async () => {
    const duplicateCode = mockPrisma({
      subject: { ...mockPrisma().subject, create: jest.fn(async () => Promise.reject(uniqueError("question_code"))) },
    });
    await expect(
      createSubject(duplicateCode as never, { name: "Math", questionCode: "MATH" })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "A subject with this question code already exists",
    });

    const duplicateName = mockPrisma({
      subject: { ...mockPrisma().subject, update: jest.fn(async () => Promise.reject(uniqueError())) },
    });
    await expect(updateSubject(duplicateName as never, "subject-vr", { name: "Math" })).rejects.toMatchObject({
      statusCode: 409,
      message: "A subject with this name already exists",
    });

    await expect(updateSubject(mockPrisma() as never, "subject-vr", {})).rejects.toMatchObject({
      statusCode: 400,
      message: "No fields to update",
    });
  });

  it("ensures a subject and deduplicated topics in one transaction", async () => {
    const prisma = mockPrisma();

    const result = await ensureSubjectWithTopics(prisma as never, {
      subject: { name: " Verbal Reasoning ", questionCode: " vr ", description: "Reasoning" },
      topics: [
        { name: " Analogies ", description: "A" },
        { name: "analogies", description: "Duplicate" },
        { name: " " },
      ],
    });

    expect(prisma.tx.subject.createMany).toHaveBeenCalledWith({
      data: [{ name: "Verbal Reasoning", questionCode: "VR", description: "Reasoning" }],
      skipDuplicates: true,
    });
    expect(prisma.tx.topic.createMany).toHaveBeenCalledWith({
      data: [{ subjectId: "subject-vr", name: "analogies", description: "Duplicate" }],
      skipDuplicates: true,
    });
    expect(result).toEqual({ subject: subject(), topics: [topic()] });
  });

  it("handles ensure subject conflicts when subject cannot be found after createMany", async () => {
    const tx = createTx();
    tx.subject.findUnique = jest.fn(async () => null);
    const prisma = mockPrisma({ $transaction: jest.fn(async (callback: (txArg: typeof tx) => unknown) => callback(tx)) });

    await expect(
      ensureSubjectWithTopics(prisma as never, {
        subject: { name: "Verbal Reasoning", questionCode: "VR" },
        topics: [],
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "A subject with this question code already exists",
    });
  });

  it("deletes subjects only when they have no topics or questions", async () => {
    const prisma = mockPrisma({
      subject: {
        ...mockPrisma().subject,
        findUnique: jest.fn(async () => ({ id: "subject-vr", _count: { topics: 0, questions: 0 } })),
      },
    });

    await deleteSubject(prisma as never, "subject-vr");
    expect(prisma.subject.delete).toHaveBeenCalledWith({ where: { id: "subject-vr" } });

    const missing = mockPrisma({
      subject: { ...mockPrisma().subject, findUnique: jest.fn(async () => null) },
    });
    await expect(deleteSubject(missing as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Subject not found",
    });

    const inUse = mockPrisma({
      subject: {
        ...mockPrisma().subject,
        findUnique: jest.fn(async () => ({ id: "subject-vr", _count: { topics: 1, questions: 2 } })),
      },
    });
    await expect(deleteSubject(inUse as never, "subject-vr")).rejects.toMatchObject({
      statusCode: 409,
      message: "Cannot delete subject: it has 1 topic(s) and 2 question(s). Remove them first.",
    });
  });

  it("lists and gets topics scoped to a subject", async () => {
    const prisma = mockPrisma();

    const listResult = await listTopics(prisma as never, "subject-vr", {
      page: 1,
      limit: 10,
      search: "analog",
      sortBy: "name",
      order: "asc",
      publishedOnly: true,
    });

    expect(prisma.topic.findMany).toHaveBeenCalledWith({
      where: {
        subjectId: "subject-vr",
        OR: [
          { name: { contains: "analog", mode: "insensitive" } },
          { description: { contains: "analog", mode: "insensitive" } },
        ],
      },
      select: expect.objectContaining({
        _count: { select: { questions: { where: { status: "PUBLISHED" } } } },
      }),
      orderBy: { name: "asc" },
      skip: 0,
      take: 10,
    });
    expect(listResult.meta.total).toBe(1);

    await expect(getTopicById(prisma as never, "subject-vr", "topic-analogies")).resolves.toEqual(topic());
  });

  it("creates and updates topics, with missing and duplicate cases", async () => {
    const prisma = mockPrisma();

    await createTopic(prisma as never, "subject-vr", { name: " Analogies ", description: undefined });
    expect(prisma.topic.create).toHaveBeenCalledWith({
      data: { subjectId: "subject-vr", name: "Analogies", description: null },
      select: expect.any(Object),
    });

    await updateTopic(prisma as never, "subject-vr", "topic-analogies", { name: " New Topic " });
    expect(prisma.topic.update).toHaveBeenCalledWith({
      where: { id: "topic-analogies" },
      data: { name: "New Topic" },
      select: expect.any(Object),
    });

    const duplicate = mockPrisma({
      topic: { ...mockPrisma().topic, create: jest.fn(async () => Promise.reject(uniqueError())) },
    });
    await expect(createTopic(duplicate as never, "subject-vr", { name: "Analogies" })).rejects.toMatchObject({
      statusCode: 409,
      message: "A topic with this name already exists in this subject",
    });

    await expect(updateTopic(mockPrisma() as never, "subject-vr", "topic-analogies", {})).rejects.toMatchObject({
      statusCode: 400,
      message: "No fields to update",
    });

    const missing = mockPrisma({
      topic: { ...mockPrisma().topic, findFirst: jest.fn(async () => null) },
    });
    await expect(getTopicById(missing as never, "subject-vr", "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Topic not found",
    });
    await expect(updateTopic(missing as never, "subject-vr", "missing", { name: "New" })).rejects.toMatchObject({
      statusCode: 404,
      message: "Topic not found in this subject",
    });
  });

  it("deletes topics only when they have no questions", async () => {
    const prisma = mockPrisma({
      topic: {
        ...mockPrisma().topic,
        findFirst: jest.fn(async () => ({ id: "topic-analogies", _count: { questions: 0 } })),
      },
    });

    await deleteTopic(prisma as never, "subject-vr", "topic-analogies");
    expect(prisma.topic.delete).toHaveBeenCalledWith({ where: { id: "topic-analogies" } });

    const missing = mockPrisma({
      topic: { ...mockPrisma().topic, findFirst: jest.fn(async () => null) },
    });
    await expect(deleteTopic(missing as never, "subject-vr", "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Topic not found",
    });

    const inUse = mockPrisma({
      topic: {
        ...mockPrisma().topic,
        findFirst: jest.fn(async () => ({ id: "topic-analogies", _count: { questions: 3 } })),
      },
    });
    await expect(deleteTopic(inUse as never, "subject-vr", "topic-analogies")).rejects.toMatchObject({
      statusCode: 409,
      message: "Cannot delete topic: it has 3 question(s). Remove them first.",
    });
  });

  it("runs subject and topic controller success responses", async () => {
    const controllerPrisma = mockPrisma({
      subject: {
        ...mockPrisma().subject,
        findUnique: jest.fn(async () => ({
          ...subject(),
          topics: [topic()],
          _count: { topics: 0, questions: 0 },
        })),
      },
      topic: {
        ...mockPrisma().topic,
        findFirst: jest.fn(async () => ({ ...topic(), _count: { questions: 0 } })),
      },
    });
    const request = mockRequest({ server: { prisma: controllerPrisma } });
    const reply = mockReply();

    await expect(subjectsController.listSubjects(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Subjects retrieved successfully",
    });
    await expect(subjectsController.getSubject(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Subject retrieved successfully",
    });
    await expect(subjectsController.createSubject(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Subject created successfully",
    });
    const ensureRequest = mockRequest({
      server: { prisma: controllerPrisma },
      body: {
        subject: { name: "Verbal Reasoning", questionCode: "VR", description: "Language and logic" },
        topics: [{ name: "Analogies" }],
      },
    });
    await expect(subjectsController.ensureSubjectWithTopics(ensureRequest as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Subject and topics ensured successfully",
    });
    await expect(subjectsController.updateSubject(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Subject updated successfully",
    });
    await expect(subjectsController.deleteSubject(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Subject deleted successfully",
    });
    await expect(subjectsController.listTopics(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Topics retrieved successfully",
    });
    await expect(subjectsController.getTopic(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Topic retrieved successfully",
    });
    await expect(subjectsController.createTopic(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Topic created successfully",
    });
    await expect(subjectsController.updateTopic(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Topic updated successfully",
    });
    await expect(subjectsController.deleteTopic(request as never, reply as never)).resolves.toMatchObject({
      success: true,
      message: "Topic deleted successfully",
    });

    expect(reply.status).toHaveBeenCalledWith(201);
    expect(request.log.info).toHaveBeenCalled();
  });
});
