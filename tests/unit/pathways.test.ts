import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const createNotificationMock = jest.fn();
const assertCanAccessStudentMock = jest.fn();
const isUniqueConstraintErrorMock = jest.fn((error: unknown) => {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
});

jest.unstable_mockModule("../../src/lib/notify.js", () => ({
  createNotification: createNotificationMock,
}));

jest.unstable_mockModule("../../src/utils/authz.js", () => ({
  assertCanAccessStudent: assertCanAccessStudentMock,
}));

jest.unstable_mockModule("../../src/utils/prisma-errors.js", () => ({
  isUniqueConstraintError: isUniqueConstraintErrorMock,
  mapPrismaError: jest.fn(() => null),
}));

const pathwaysService = await import("../../src/modules/pathways/pathways.service.js");
const pathwaysController = await import("../../src/modules/pathways/pathways.controller.js");

const now = new Date("2026-05-08T00:00:00.000Z");
const completedAt = new Date("2026-05-08T01:00:00.000Z");

function pathway(overrides: Record<string, unknown> = {}) {
  return {
    id: "pathway-1",
    studentId: "student-1",
    subjectId: "subject-vr",
    tutorId: "tutor-1",
    thresholdCorrect: 3,
    createdAt: now,
    updatedAt: now,
    subject: { id: "subject-vr", name: "Verbal Reasoning" },
    _count: { nodes: 2 },
    ...overrides,
  };
}

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: "node-1",
    pathwayId: "pathway-1",
    topicId: "topic-1",
    orderIndex: 0,
    createdAt: now,
    updatedAt: now,
    topic: { id: "topic-1", name: "Analogies", subjectId: "subject-vr" },
    progress: [
      {
        correctAnswers: 2,
        totalAttempts: 5,
        isUnlocked: true,
        completedAt: null,
      },
    ],
    ...overrides,
  };
}

function formattedPathway(overrides: Record<string, unknown> = {}) {
  return {
    id: "pathway-1",
    studentId: "student-1",
    subjectId: "subject-vr",
    tutorId: "tutor-1",
    thresholdCorrect: 3,
    nodeCount: 2,
    subject: { id: "subject-vr", name: "Verbal Reasoning" },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function formattedNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "node-1",
    pathwayId: "pathway-1",
    topicId: "topic-1",
    orderIndex: 0,
    topic: { id: "topic-1", name: "Analogies", subjectId: "subject-vr" },
    progress: {
      correctAnswers: 2,
      totalAttempts: 5,
      isUnlocked: true,
      completedAt: null,
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function createTx() {
  return {
    studentPathway: {
      create: jest.fn(async () => ({ id: "pathway-1" })),
      findUnique: jest.fn(async () => ({ ...pathway(), nodes: [node()] })),
    },
    pathwayNode: {
      create: jest
        .fn()
        .mockResolvedValueOnce({ id: "node-1" } as never)
        .mockResolvedValueOnce({ id: "node-2" } as never)
        .mockResolvedValue(node({ id: "node-3", topicId: "topic-3", orderIndex: 1, progress: [] }) as never),
      delete: jest.fn(async () => undefined),
      findMany: jest.fn(async () => [{ id: "node-2" }, { id: "node-3" }]),
      update: jest.fn(async () => undefined),
    },
    pathwayNodeProgress: {
      create: jest.fn(async () => undefined),
      upsert: jest.fn(async () => undefined),
    },
    practiceSession: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: "practice-1", topicId: "topic-1" })),
    },
    practiceSessionQuestion: {
      createMany: jest.fn(async () => ({ count: 2 })),
    },
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const tx = createTx();
  return {
    tx,
    $transaction: jest.fn(async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (txArg: typeof tx) => Promise<unknown>)(tx);
      return Promise.all(arg as Promise<unknown>[]);
    }),
    studentPathway: {
      findMany: jest.fn(async () => [pathway()]),
      findUnique: jest.fn(async () => ({ ...pathway(), nodes: [node()] })),
      delete: jest.fn(async () => pathway()),
    },
    subject: {
      findUnique: jest.fn(async () => ({
        id: "subject-vr",
        name: "Verbal Reasoning",
        topics: [{ id: "topic-1" }, { id: "topic-2" }],
      })),
    },
    user: {
      findUnique: jest.fn(async () => ({ id: "student-1", role: "STUDENT" })),
    },
    topic: {
      findUnique: jest.fn(async () => ({ id: "topic-3" })),
    },
    pathwayNode: {
      findFirst: jest.fn(async () => node({ pathway: { id: "pathway-1", thresholdCorrect: 3 } })),
      findMany: jest.fn(async () => [{ id: "node-1" }, { id: "node-2" }]),
      update: jest.fn(async () => undefined),
    },
    pathwayNodeProgress: {
      upsert: jest.fn(async () => ({
        correctAnswers: 3,
        totalAttempts: 5,
        isUnlocked: true,
        completedAt,
      })),
    },
    question: {
      findMany: jest.fn(async () => [{ id: "question-1" }, { id: "question-2" }]),
    },
    practiceSession: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: "practice-1", topicId: "topic-1" })),
    },
    practiceSessionQuestion: {
      createMany: jest.fn(async () => ({ count: 2 })),
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
    query: {},
    params: { id: "pathway-1", nodeId: "node-1" },
    body: {
      studentId: "student-1",
      subjectId: "subject-vr",
      thresholdCorrect: 3,
      topicId: "topic-3",
      order: [{ nodeId: "node-1", orderIndex: 1 }],
      correctAnswers: 3,
      totalAttempts: 5,
    },
    user: { sub: "student-1", role: "STUDENT" },
    server: { prisma: mockPrisma() },
    log: { info: jest.fn() },
    ...overrides,
  };
}

describe("pathways module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createNotificationMock.mockResolvedValue(undefined as never);
    assertCanAccessStudentMock.mockResolvedValue(undefined as never);
    isUniqueConstraintErrorMock.mockImplementation((error: unknown) =>
      Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002")
    );
  });

  it("lists pathways for a student", async () => {
    const prisma = mockPrisma();

    const result = await pathwaysService.listPathways(prisma as never, "student-1");

    expect(prisma.studentPathway.findMany).toHaveBeenCalledWith({
      where: { studentId: "student-1" },
      select: expect.any(Object),
      orderBy: { createdAt: "asc" },
    });
    expect(result).toEqual([formattedPathway()]);
  });

  it("gets pathway detail with formatted nodes and progress", async () => {
    const prisma = mockPrisma({
      studentPathway: {
        ...mockPrisma().studentPathway,
        findUnique: jest.fn(async () => ({ ...pathway(), nodes: [node()] })),
      },
    });

    const result = await pathwaysService.getPathwayDetail(prisma as never, "pathway-1", "student-1");

    expect(result).toEqual({ ...formattedPathway(), nodes: [formattedNode()] });
  });

  it("throws 404 when pathway detail is missing", async () => {
    const prisma = mockPrisma({
      studentPathway: {
        ...mockPrisma().studentPathway,
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(
      pathwaysService.getPathwayDetail(prisma as never, "missing", "student-1")
    ).rejects.toMatchObject({ statusCode: 404, message: "Pathway not found" });
  });

  it("creates a pathway with subject topics, progress rows, and notification", async () => {
    const prisma = mockPrisma();

    const result = await pathwaysService.createPathway(prisma as never, "tutor-1", {
      studentId: "student-1",
      subjectId: "subject-vr",
      thresholdCorrect: 3,
    });

    expect(prisma.subject.findUnique).toHaveBeenCalledWith({
      where: { id: "subject-vr" },
      select: {
        id: true,
        name: true,
        topics: { select: { id: true }, orderBy: { name: "asc" } },
      },
    });
    expect(prisma.tx.studentPathway.create).toHaveBeenCalledWith({
      data: {
        studentId: "student-1",
        subjectId: "subject-vr",
        tutorId: "tutor-1",
        thresholdCorrect: 3,
      },
    });
    expect(prisma.tx.pathwayNode.create).toHaveBeenCalledTimes(2);
    expect(prisma.tx.pathwayNodeProgress.create).toHaveBeenCalledWith({
      data: { nodeId: "node-1", studentId: "student-1", isUnlocked: true },
    });
    expect(prisma.tx.pathwayNodeProgress.create).toHaveBeenCalledWith({
      data: { nodeId: "node-2", studentId: "student-1", isUnlocked: false },
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: "student-1",
        type: "PATHWAY_ASSIGNED",
        data: { pathwayId: "pathway-1", subjectId: "subject-vr", subjectName: "Verbal Reasoning" },
      })
    );
    expect(result.id).toBe("pathway-1");
  });

  it("rejects create pathway for missing subject, missing student, or duplicate pathway", async () => {
    const noSubject = mockPrisma({ subject: { findUnique: jest.fn(async () => null) } });
    await expect(
      pathwaysService.createPathway(noSubject as never, "tutor-1", {
        studentId: "student-1",
        subjectId: "missing",
        thresholdCorrect: 3,
      })
    ).rejects.toMatchObject({ statusCode: 404, message: "Subject not found" });

    const noStudent = mockPrisma({ user: { findUnique: jest.fn(async () => ({ id: "parent-1", role: "PARENT" })) } });
    await expect(
      pathwaysService.createPathway(noStudent as never, "tutor-1", {
        studentId: "parent-1",
        subjectId: "subject-vr",
        thresholdCorrect: 3,
      })
    ).rejects.toMatchObject({ statusCode: 404, message: "Student not found" });

    const duplicate = mockPrisma({
      $transaction: jest.fn(async () => {
        throw { code: "P2002" };
      }),
    });
    await expect(
      pathwaysService.createPathway(duplicate as never, "tutor-1", {
        studentId: "student-1",
        subjectId: "subject-vr",
        thresholdCorrect: 3,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "A pathway for this subject already exists for this student",
    });
  });

  it("deletes existing pathways and rejects missing ones", async () => {
    const prisma = mockPrisma();
    await pathwaysService.deletePathway(prisma as never, "pathway-1");
    expect(prisma.studentPathway.delete).toHaveBeenCalledWith({ where: { id: "pathway-1" } });

    const missing = mockPrisma({
      studentPathway: { ...mockPrisma().studentPathway, findUnique: jest.fn(async () => null) },
    });
    await expect(pathwaysService.deletePathway(missing as never, "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Pathway not found",
    });
  });

  it("adds a node with progress and handles missing or duplicate cases", async () => {
    const prisma = mockPrisma({
      studentPathway: {
        ...mockPrisma().studentPathway,
        findUnique: jest.fn(async () => ({ ...pathway(), nodes: [{ orderIndex: 1 }] })),
      },
    });
    prisma.tx.pathwayNode.create.mockReset();
    prisma.tx.pathwayNode.create.mockResolvedValueOnce(node({ id: "node-3", topicId: "topic-3", orderIndex: 2, progress: [] }) as never);

    const result = await pathwaysService.addNode(prisma as never, "pathway-1", "student-1", {
      topicId: "topic-3",
    });

    expect(prisma.tx.pathwayNode.create).toHaveBeenCalledWith({
      data: { pathwayId: "pathway-1", topicId: "topic-3", orderIndex: 2 },
      select: expect.any(Object),
    });
    expect(prisma.tx.pathwayNodeProgress.create).toHaveBeenCalledWith({
      data: { nodeId: "node-3", studentId: "student-1", isUnlocked: false },
    });
    expect(result).toMatchObject({ id: "node-3", progress: null });

    const noPathway = mockPrisma({
      studentPathway: { ...mockPrisma().studentPathway, findUnique: jest.fn(async () => null) },
    });
    await expect(
      pathwaysService.addNode(noPathway as never, "missing", "student-1", { topicId: "topic-3" })
    ).rejects.toMatchObject({ statusCode: 404, message: "Pathway not found" });

    const noTopic = mockPrisma({ topic: { findUnique: jest.fn(async () => null) } });
    await expect(
      pathwaysService.addNode(noTopic as never, "pathway-1", "student-1", { topicId: "missing" })
    ).rejects.toMatchObject({ statusCode: 404, message: "Topic not found" });

    const duplicate = mockPrisma({
      $transaction: jest.fn(async () => {
        throw { code: "P2002" };
      }),
    });
    await expect(
      pathwaysService.addNode(duplicate as never, "pathway-1", "student-1", { topicId: "topic-3" })
    ).rejects.toMatchObject({ statusCode: 409, message: "This topic is already in the pathway" });
  });

  it("removes a node and reindexes remaining nodes", async () => {
    const prisma = mockPrisma();

    await pathwaysService.removeNode(prisma as never, "pathway-1", "node-1");

    expect(prisma.tx.pathwayNode.delete).toHaveBeenCalledWith({ where: { id: "node-1" } });
    expect(prisma.tx.pathwayNode.update).toHaveBeenCalledWith({
      where: { id: "node-2" },
      data: { orderIndex: 0 },
    });
    expect(prisma.tx.pathwayNode.update).toHaveBeenCalledWith({
      where: { id: "node-3" },
      data: { orderIndex: 1 },
    });

    const missing = mockPrisma({
      pathwayNode: { ...mockPrisma().pathwayNode, findFirst: jest.fn(async () => null) },
    });
    await expect(pathwaysService.removeNode(missing as never, "pathway-1", "missing")).rejects.toMatchObject({
      statusCode: 404,
      message: "Node not found in pathway",
    });
  });

  it("reorders nodes and rejects nodes outside the pathway", async () => {
    const prisma = mockPrisma({
      studentPathway: {
        ...mockPrisma().studentPathway,
        findUnique: jest.fn(async () => ({ nodes: [node({ id: "node-2", orderIndex: 0 })] })),
      },
    });

    const result = await pathwaysService.reorderNodes(prisma as never, "pathway-1", "student-1", {
      order: [{ nodeId: "node-1", orderIndex: 1 }],
    });

    expect(prisma.tx.pathwayNode.update).toHaveBeenNthCalledWith(1, {
      where: { id: "node-1" },
      data: { orderIndex: -4 },
    });
    expect(prisma.tx.pathwayNode.update).toHaveBeenNthCalledWith(2, {
      where: { id: "node-1" },
      data: { orderIndex: 1 },
    });
    expect(result).toEqual([formattedNode({ id: "node-2", orderIndex: 0 })]);

    await expect(
      pathwaysService.reorderNodes(prisma as never, "pathway-1", "student-1", {
        order: [{ nodeId: "outsider", orderIndex: 0 }],
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Node outsider does not belong to this pathway",
    });
  });

  it("starts practice only for unlocked nodes", async () => {
    const prisma = mockPrisma();

    const result = await pathwaysService.startNodePractice(prisma as never, "pathway-1", "node-1", "student-1");

    expect(prisma.question.findMany).toHaveBeenCalledWith({
      where: { topicId: "topic-1", type: "MCQ", status: "PUBLISHED" },
      select: { id: true },
      take: 10,
    });
    expect(prisma.tx.practiceSession.create).toHaveBeenCalledWith({
      data: {
        studentId: "student-1",
        topicId: "topic-1",
        sourceType: "PATHWAY",
        pathwayNodeId: "node-1",
        status: "IN_PROGRESS",
        questionCount: 2,
      },
      select: { id: true, topicId: true },
    });
    expect(prisma.tx.practiceSessionQuestion.createMany).toHaveBeenCalledWith({
      data: [
        { sessionId: "practice-1", questionId: "question-1", order: 1 },
        { sessionId: "practice-1", questionId: "question-2", order: 2 },
      ],
    });
    expect(result).toEqual({ sessionId: "practice-1", topicId: "topic-1", nodeId: "node-1" });

    const locked = mockPrisma({
      pathwayNode: { ...mockPrisma().pathwayNode, findFirst: jest.fn(async () => ({ id: "node-1", topicId: "topic-1", progress: [] })) },
    });
    await expect(
      pathwaysService.startNodePractice(locked as never, "pathway-1", "node-1", "student-1")
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "This node is locked. Complete the previous node first.",
    });
  });

  it("updates progress, unlocks the next node, and notifies the student", async () => {
    const prisma = mockPrisma({
      pathwayNode: {
        ...mockPrisma().pathwayNode,
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "node-1", orderIndex: 0, pathway: { thresholdCorrect: 3, id: "pathway-1" } } as never)
          .mockResolvedValueOnce({ id: "node-2", topic: { name: "Logical Reasoning" } } as never),
      },
    });

    const result = await pathwaysService.updateNodeProgress(prisma as never, "pathway-1", "node-1", "student-1", {
      correctAnswers: 3,
      totalAttempts: 5,
    });

    expect(prisma.pathwayNodeProgress.upsert).toHaveBeenCalledWith({
      where: { nodeId_studentId: { nodeId: "node-1", studentId: "student-1" } },
      create: {
        nodeId: "node-1",
        studentId: "student-1",
        correctAnswers: 3,
        totalAttempts: 5,
        isUnlocked: true,
        completedAt: expect.any(Date),
      },
      update: {
        correctAnswers: 3,
        totalAttempts: 5,
        completedAt: expect.any(Date),
      },
      select: {
        correctAnswers: true,
        totalAttempts: true,
        isUnlocked: true,
        completedAt: true,
      },
    });
    expect(prisma.pathwayNodeProgress.upsert).toHaveBeenCalledWith({
      where: { nodeId_studentId: { nodeId: "node-2", studentId: "student-1" } },
      create: { nodeId: "node-2", studentId: "student-1", isUnlocked: true },
      update: { isUnlocked: true },
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: "student-1",
        type: "PATHWAY_NODE_UNLOCKED",
        data: { pathwayId: "pathway-1", nodeId: "node-2", topicName: "Logical Reasoning" },
      })
    );
    expect(result).toEqual({
      correctAnswers: 3,
      totalAttempts: 5,
      isUnlocked: true,
      completedAt: completedAt.toISOString(),
    });
  });

  it("updates progress without completing when below threshold", async () => {
    const prisma = mockPrisma({
      pathwayNode: {
        ...mockPrisma().pathwayNode,
        findFirst: jest.fn(async () => ({ id: "node-1", orderIndex: 0, pathway: { thresholdCorrect: 3, id: "pathway-1" } })),
      },
      pathwayNodeProgress: {
        upsert: jest.fn(async () => ({
          correctAnswers: 2,
          totalAttempts: 5,
          isUnlocked: true,
          completedAt: null,
        })),
      },
    });

    const result = await pathwaysService.updateNodeProgress(prisma as never, "pathway-1", "node-1", "student-1", {
      correctAnswers: 2,
      totalAttempts: 5,
    });

    expect(prisma.pathwayNode.findFirst).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(result.completedAt).toBeNull();
  });

  it("handles pathway controller success and not-found responses", async () => {
    const request = mockRequest();
    const reply = mockReply();

    const listResponse = await pathwaysController.listPathwaysHandler(request as never, reply as never);
    const getResponse = await pathwaysController.getPathwayHandler(request as never, reply as never);
    const createResponse = await pathwaysController.createPathwayHandler(request as never, reply as never);
    const deleteResponse = await pathwaysController.deletePathwayHandler(request as never, reply as never);
    const addResponse = await pathwaysController.addNodeHandler(request as never, reply as never);
    const removeResponse = await pathwaysController.removeNodeHandler(request as never, reply as never);
    const reorderResponse = await pathwaysController.reorderNodesHandler(request as never, reply as never);
    const startResponse = await pathwaysController.startPracticeHandler(request as never, reply as never);
    const progressResponse = await pathwaysController.updateProgressHandler(request as never, reply as never);

    expect(assertCanAccessStudentMock).toHaveBeenCalled();
    expect(listResponse).toMatchObject({ success: true, message: "Pathways retrieved" });
    expect(getResponse).toMatchObject({ success: true, message: "Pathway retrieved" });
    expect(createResponse).toMatchObject({ success: true, message: "Pathway created" });
    expect(deleteResponse).toEqual({ success: true, message: "Pathway deleted" });
    expect(addResponse).toMatchObject({ success: true, message: "Node added to pathway" });
    expect(removeResponse).toEqual({ success: true, message: "Node removed from pathway" });
    expect(reorderResponse).toMatchObject({ success: true, message: "Nodes reordered" });
    expect(startResponse).toMatchObject({ success: true, message: "Practice session started" });
    expect(progressResponse).toMatchObject({ success: true, message: "Progress updated" });

    const notFoundRequest = mockRequest({
      server: {
        prisma: mockPrisma({
          studentPathway: { ...mockPrisma().studentPathway, findUnique: jest.fn(async () => null) },
        }),
      },
    });
    const notFoundReply = mockReply();
    await expect(pathwaysController.getPathwayHandler(notFoundRequest as never, notFoundReply as never)).resolves.toEqual({
      success: false,
      message: "Pathway not found",
      statusCode: 404,
    });
    expect(notFoundReply.status).toHaveBeenCalledWith(404);
  });
});
