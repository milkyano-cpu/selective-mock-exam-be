import type { PrismaClient } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";
import { isUniqueConstraintError } from "../../utils/prisma-errors.js";
import { createNotification } from "../../lib/notify.js";
import type { CreatePathwayInput, AddNodeInput, ReorderNodesInput, UpdateProgressInput } from "./pathways.schema.js";

// ── SELECT shapes ────────────────────────────────────────────────────────────

const PATHWAY_LIST_SELECT = {
  id: true,
  studentId: true,
  subjectId: true,
  tutorId: true,
  thresholdCorrect: true,
  createdAt: true,
  updatedAt: true,
  subject: { select: { id: true, name: true } },
  _count: { select: { nodes: true } },
} as const;

function nodeWithProgressSelect(studentId: string) {
  return {
    id: true,
    pathwayId: true,
    topicId: true,
    orderIndex: true,
    createdAt: true,
    updatedAt: true,
    topic: { select: { id: true, name: true, subjectId: true } },
    progress: {
      where: { studentId },
      select: {
        correctAnswers: true,
        totalAttempts: true,
        isUnlocked: true,
        completedAt: true,
      },
      take: 1,
    },
  } as const;
}

function formatPathwayItem(
  p: { _count: { nodes: number }; id: string; studentId: string; subjectId: string; tutorId: string; thresholdCorrect: number; createdAt: Date; updatedAt: Date; subject: { id: string; name: string } }
) {
  return {
    id: p.id,
    studentId: p.studentId,
    subjectId: p.subjectId,
    tutorId: p.tutorId,
    thresholdCorrect: p.thresholdCorrect,
    nodeCount: p._count.nodes,
    subject: p.subject,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function formatNode(n: {
  id: string;
  pathwayId: string;
  topicId: string;
  orderIndex: number;
  createdAt: Date;
  updatedAt: Date;
  topic: { id: string; name: string; subjectId: string };
  progress: { correctAnswers: number; totalAttempts: number; isUnlocked: boolean; completedAt: Date | null }[];
}) {
  return {
    id: n.id,
    pathwayId: n.pathwayId,
    topicId: n.topicId,
    orderIndex: n.orderIndex,
    topic: n.topic,
    progress: n.progress[0]
      ? {
          correctAnswers: n.progress[0].correctAnswers,
          totalAttempts: n.progress[0].totalAttempts,
          isUnlocked: n.progress[0].isUnlocked,
          completedAt: n.progress[0].completedAt?.toISOString() ?? null,
        }
      : null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

// ── listPathways ─────────────────────────────────────────────────────────────

export async function listPathways(prisma: PrismaClient, studentId: string) {
  const pathways = await prisma.studentPathway.findMany({
    where: { studentId },
    select: PATHWAY_LIST_SELECT,
    orderBy: { createdAt: "asc" },
  });

  return pathways.map(formatPathwayItem);
}

// ── getPathwayDetail ─────────────────────────────────────────────────────────

export async function getPathwayDetail(
  prisma: PrismaClient,
  pathwayId: string,
  studentId: string
) {
  const pathway = await prisma.studentPathway.findUnique({
    where: { id: pathwayId },
    select: {
      ...PATHWAY_LIST_SELECT,
      nodes: {
        select: nodeWithProgressSelect(studentId),
        orderBy: { orderIndex: "asc" },
      },
    },
  });

  if (!pathway) throw createHttpError(404, "Pathway not found");

  return {
    ...formatPathwayItem(pathway),
    nodes: pathway.nodes.map(formatNode),
  };
}

// ── createPathway ─────────────────────────────────────────────────────────────

export async function createPathway(
  prisma: PrismaClient,
  tutorId: string,
  input: CreatePathwayInput
) {
  const subject = await prisma.subject.findUnique({
    where: { id: input.subjectId },
    select: {
      id: true,
      name: true,
      topics: { select: { id: true }, orderBy: { name: "asc" } },
    },
  });
  if (!subject) throw createHttpError(404, "Subject not found");

  const student = await prisma.user.findUnique({
    where: { id: input.studentId },
    select: { id: true, role: true },
  });
  if (!student || student.role !== "STUDENT") {
    throw createHttpError(404, "Student not found");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const pathway = await tx.studentPathway.create({
        data: {
          studentId: input.studentId,
          subjectId: input.subjectId,
          tutorId,
          thresholdCorrect: input.thresholdCorrect,
        },
      });

      if (subject.topics.length > 0) {
        const nodes = await Promise.all(
          subject.topics.map((topic, idx) =>
            tx.pathwayNode.create({
              data: { pathwayId: pathway.id, topicId: topic.id, orderIndex: idx },
            })
          )
        );

        await Promise.all(
          nodes.map((node, idx) =>
            tx.pathwayNodeProgress.create({
              data: {
                nodeId: node.id,
                studentId: input.studentId,
                isUnlocked: idx === 0,
              },
            })
          )
        );
      }

      return getPathwayDetail(
        tx as unknown as PrismaClient,
        pathway.id,
        input.studentId
      );
    });

    // Notify student — fire-and-forget, not critical
    void createNotification(prisma, {
      userId: input.studentId,
      type: "PATHWAY_ASSIGNED",
      title: "New Learning Pathway Assigned",
      message: `Your tutor has assigned you a new learning pathway: ${subject.name}`,
      data: { pathwayId: result.id, subjectId: subject.id, subjectName: subject.name },
    });

    return result;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "A pathway for this subject already exists for this student");
    }
    throw error;
  }
}

// ── deletePathway ─────────────────────────────────────────────────────────────

export async function deletePathway(prisma: PrismaClient, pathwayId: string) {
  const pathway = await prisma.studentPathway.findUnique({
    where: { id: pathwayId },
    select: { id: true },
  });
  if (!pathway) throw createHttpError(404, "Pathway not found");

  await prisma.studentPathway.delete({ where: { id: pathwayId } });
}

// ── addNode ───────────────────────────────────────────────────────────────────

export async function addNode(
  prisma: PrismaClient,
  pathwayId: string,
  studentId: string,
  input: AddNodeInput
) {
  const pathway = await prisma.studentPathway.findUnique({
    where: { id: pathwayId },
    select: {
      id: true,
      studentId: true,
      nodes: {
        select: { orderIndex: true },
        orderBy: { orderIndex: "desc" },
        take: 1,
      },
    },
  });
  if (!pathway) throw createHttpError(404, "Pathway not found");

  const topic = await prisma.topic.findUnique({
    where: { id: input.topicId },
    select: { id: true },
  });
  if (!topic) throw createHttpError(404, "Topic not found");

  const nextIndex = (pathway.nodes[0]?.orderIndex ?? -1) + 1;
  const isFirstNode = nextIndex === 0;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const newNode = await tx.pathwayNode.create({
        data: { pathwayId, topicId: input.topicId, orderIndex: nextIndex },
        select: nodeWithProgressSelect(studentId),
      });

      await tx.pathwayNodeProgress.create({
        data: {
          nodeId: newNode.id,
          studentId: pathway.studentId,
          isUnlocked: isFirstNode,
        },
      });

      return newNode;
    });

    return formatNode(result);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "This topic is already in the pathway");
    }
    throw error;
  }
}

// ── removeNode ────────────────────────────────────────────────────────────────

export async function removeNode(
  prisma: PrismaClient,
  pathwayId: string,
  nodeId: string
) {
  const node = await prisma.pathwayNode.findFirst({
    where: { id: nodeId, pathwayId },
    select: { id: true },
  });
  if (!node) throw createHttpError(404, "Node not found in pathway");

  await prisma.$transaction(async (tx) => {
    await tx.pathwayNode.delete({ where: { id: nodeId } });

    const remaining = await tx.pathwayNode.findMany({
      where: { pathwayId },
      orderBy: { orderIndex: "asc" },
      select: { id: true },
    });

    await Promise.all(
      remaining.map((n, idx) =>
        tx.pathwayNode.update({
          where: { id: n.id },
          data: { orderIndex: idx },
        })
      )
    );
  });
}

// ── reorderNodes ──────────────────────────────────────────────────────────────

export async function reorderNodes(
  prisma: PrismaClient,
  pathwayId: string,
  studentId: string,
  input: ReorderNodesInput
) {
  const existingNodes = await prisma.pathwayNode.findMany({
    where: { pathwayId },
    select: { id: true },
  });

  const existingIds = new Set(existingNodes.map((n) => n.id));
  for (const item of input.order) {
    if (!existingIds.has(item.nodeId)) {
      throw createHttpError(400, `Node ${item.nodeId} does not belong to this pathway`);
    }
  }

  await prisma.$transaction(
    input.order.map((item) =>
      prisma.pathwayNode.update({
        where: { id: item.nodeId },
        data: { orderIndex: item.orderIndex },
      })
    )
  );

  const pathway = await prisma.studentPathway.findUnique({
    where: { id: pathwayId },
    select: {
      nodes: {
        select: nodeWithProgressSelect(studentId),
        orderBy: { orderIndex: "asc" },
      },
    },
  });

  return (pathway?.nodes ?? []).map(formatNode);
}

// ── startNodePractice ─────────────────────────────────────────────────────────

export async function startNodePractice(
  prisma: PrismaClient,
  pathwayId: string,
  nodeId: string,
  studentId: string
) {
  const node = await prisma.pathwayNode.findFirst({
    where: { id: nodeId, pathwayId },
    select: {
      id: true,
      topicId: true,
      progress: {
        where: { studentId },
        select: { isUnlocked: true },
        take: 1,
      },
    },
  });

  if (!node) throw createHttpError(404, "Node not found in pathway");

  const isUnlocked = node.progress[0]?.isUnlocked ?? false;
  if (!isUnlocked) throw createHttpError(403, "This node is locked. Complete the previous node first.");

  const session = await prisma.practiceSession.create({
    data: {
      studentId,
      topicId: node.topicId,
      sourceType: "PATHWAY",
      pathwayNodeId: node.id,
    },
    select: { id: true, topicId: true },
  });

  return {
    sessionId: session.id,
    topicId: session.topicId ?? "",
    nodeId: node.id,
  };
}

// ── updateNodeProgress ────────────────────────────────────────────────────────

export async function updateNodeProgress(
  prisma: PrismaClient,
  pathwayId: string,
  nodeId: string,
  studentId: string,
  input: UpdateProgressInput
) {
  const node = await prisma.pathwayNode.findFirst({
    where: { id: nodeId, pathwayId },
    select: {
      id: true,
      orderIndex: true,
      pathway: { select: { thresholdCorrect: true, id: true } },
    },
  });
  if (!node) throw createHttpError(404, "Node not found in pathway");

  const threshold = node.pathway.thresholdCorrect;
  const isNowCompleted = input.correctAnswers >= threshold;

  const progress = await prisma.pathwayNodeProgress.upsert({
    where: { nodeId_studentId: { nodeId, studentId } },
    create: {
      nodeId,
      studentId,
      correctAnswers: input.correctAnswers,
      totalAttempts: input.totalAttempts,
      isUnlocked: true,
      completedAt: isNowCompleted ? new Date() : null,
    },
    update: {
      correctAnswers: input.correctAnswers,
      totalAttempts: input.totalAttempts,
      completedAt: isNowCompleted ? new Date() : null,
    },
    select: {
      correctAnswers: true,
      totalAttempts: true,
      isUnlocked: true,
      completedAt: true,
    },
  });

  // Unlock the next node if threshold is met
  if (isNowCompleted) {
    const nextNode = await prisma.pathwayNode.findFirst({
      where: { pathwayId: node.pathway.id, orderIndex: node.orderIndex + 1 },
      select: { id: true, topic: { select: { name: true } } },
    });

    if (nextNode) {
      await prisma.pathwayNodeProgress.upsert({
        where: { nodeId_studentId: { nodeId: nextNode.id, studentId } },
        create: { nodeId: nextNode.id, studentId, isUnlocked: true },
        update: { isUnlocked: true },
      });

      // Notify student that the next topic is now unlocked
      void createNotification(prisma, {
        userId: studentId,
        type: "PATHWAY_NODE_UNLOCKED",
        title: "New Topic Unlocked!",
        message: `Great job! You've unlocked the next topic: ${nextNode.topic.name}`,
        data: { pathwayId, nodeId: nextNode.id, topicName: nextNode.topic.name },
      });
    }
  }

  return {
    correctAnswers: progress.correctAnswers,
    totalAttempts: progress.totalAttempts,
    isUnlocked: progress.isUnlocked,
    completedAt: progress.completedAt?.toISOString() ?? null,
  };
}
