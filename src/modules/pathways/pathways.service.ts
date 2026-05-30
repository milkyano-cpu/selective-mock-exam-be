import type { PrismaClient } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";
import { isUniqueConstraintError } from "../../utils/prisma-errors.js";
import { createNotification } from "../../lib/notify.js";
import type { CreatePathwayInput, AddNodeInput, ReorderNodesInput, UpdateProgressInput } from "./pathways.schema.js";

// ── SELECT shapes ────────────────────────────────────────────────────────────

const PATHWAY_LIST_SELECT = {
  id: true,
  planId: true,
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
    _count: { select: { questions: true } },
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
  p: { _count: { nodes: number }; id: string; planId: string; studentId: string; subjectId: string; tutorId: string; thresholdCorrect: number; createdAt: Date; updatedAt: Date; subject: { id: string; name: string } }
) {
  return {
    id: p.id,
    planId: p.planId,
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
  _count?: { questions: number };
  progress: { correctAnswers: number; totalAttempts: number; isUnlocked: boolean; completedAt: Date | null }[];
}) {
  return {
    id: n.id,
    pathwayId: n.pathwayId,
    topicId: n.topicId,
    orderIndex: n.orderIndex,
    topic: n.topic,
    questionCount: n._count?.questions ?? 0,
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

// Fisher-Yates shuffle — used so retakes do not present the same order
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = temp;
  }
  return result;
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
  actor: { sub: string; role: string },
  input: CreatePathwayInput
) {
  const plan = await prisma.pathwayPlan.findUnique({
    where: { id: input.planId },
    select: { id: true, tutorId: true, studentId: true, completedAt: true },
  });
  if (!plan) throw createHttpError(404, "Pathway plan not found");

  if (actor.role !== "ADMIN" && plan.tutorId !== actor.sub) {
    throw createHttpError(403, "You do not own this pathway plan");
  }

  const subject = await prisma.subject.findUnique({
    where: { id: input.subjectId },
    select: {
      id: true,
      name: true,
      topics: { select: { id: true }, orderBy: { name: "asc" } },
    },
  });
  if (!subject) throw createHttpError(404, "Subject not found");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const pathway = await tx.studentPathway.create({
        data: {
          planId: plan.id,
          studentId: plan.studentId,
          subjectId: input.subjectId,
          tutorId: plan.tutorId,
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
                studentId: plan.studentId,
                isUnlocked: idx === 0,
              },
            })
          )
        );
      }

      // Adding a new pathway to an already-complete plan re-opens it
      if (plan.completedAt !== null) {
        await tx.pathwayPlan.update({
          where: { id: plan.id },
          data: { completedAt: null },
        });
      }

      return getPathwayDetail(
        tx as unknown as PrismaClient,
        pathway.id,
        plan.studentId
      );
    });

    // Notify student — fire-and-forget, not critical
    void createNotification(prisma, {
      userId: plan.studentId,
      type: "PATHWAY_ASSIGNED",
      title: "New Learning Pathway Assigned",
      message: `Your tutor has assigned you a new learning pathway: ${subject.name}`,
      data: { pathwayId: result.id, planId: plan.id, subjectId: subject.id, subjectName: subject.name },
    });

    return result;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw createHttpError(409, "A pathway for this subject already exists in this plan");
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
      planId: true,
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

      // Adding a node to a pathway inside an already-complete plan re-opens it
      await tx.pathwayPlan.updateMany({
        where: { id: pathway.planId, completedAt: { not: null } },
        data: { completedAt: null },
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

  await prisma.$transaction(async (tx) => {
    const temporaryOffset = input.order.length + existingNodes.length + 1;

    await Promise.all(
      input.order.map((item, idx) =>
        tx.pathwayNode.update({
          where: { id: item.nodeId },
          data: { orderIndex: -(temporaryOffset + idx) },
        })
      )
    );

    await Promise.all(
      input.order.map((item) =>
        tx.pathwayNode.update({
          where: { id: item.nodeId },
          data: { orderIndex: item.orderIndex },
        })
      )
    );
  });

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
      pathway: { select: { thresholdCorrect: true } },
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

  const existingSession = await prisma.practiceSession.findFirst({
    where: {
      studentId,
      sourceType: "PATHWAY",
      pathwayNodeId: node.id,
      status: "IN_PROGRESS",
    },
    select: {
      id: true,
      topicId: true,
      _count: { select: { sessionQuestions: true } },
    },
  });

  if (existingSession && existingSession._count.sessionQuestions > 0) {
    return {
      sessionId: existingSession.id,
      topicId: existingSession.topicId ?? "",
      nodeId: node.id,
    };
  }

  // Questions are curated by the tutor per node — never a topic-wide fallback.
  const curatedQuestions = await getNodeQuestions(prisma, node.id);

  if (curatedQuestions.length === 0) {
    throw createHttpError(422, "No questions have been added to this node yet.");
  }

  // A node with fewer questions than the pass threshold can never be completed
  // (max correct < threshold), which would stall the pathway. Block it clearly.
  if (curatedQuestions.length < node.pathway.thresholdCorrect) {
    throw createHttpError(
      422,
      "This node doesn't have enough questions yet. Ask your tutor to add more."
    );
  }

  // Shuffle so retakes do not present the same order, but always the same set.
  const questions = shuffle(curatedQuestions.map((nq) => nq.question));

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.practiceSession.create({
      data: {
        studentId,
        topicId: node.topicId,
        sourceType: "PATHWAY",
        pathwayNodeId: node.id,
        status: "IN_PROGRESS",
        questionCount: questions.length,
      },
      select: { id: true, topicId: true },
    });

    await tx.practiceSessionQuestion.createMany({
      data: questions.map((question, index) => ({
        sessionId: created.id,
        questionId: question.id,
        order: index + 1,
      })),
    });

    return created;
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

// ── Node question curation (SME-111) ──────────────────────────────────────────

const NODE_QUESTION_SELECT = {
  id: true,
  nodeId: true,
  questionId: true,
  orderIndex: true,
  question: {
    select: {
      id: true,
      type: true,
      difficulty: true,
      status: true,
      questionText: true,
      latexEnabled: true,
      options: true,
      correctAnswer: true,
      explanation: true,
      topicId: true,
      topic: { select: { id: true, name: true } },
    },
  },
} as const;

type NodeQuestionRow = {
  id: string;
  nodeId: string;
  questionId: string;
  orderIndex: number;
  question: {
    id: string;
    type: string;
    difficulty: string;
    status: string;
    questionText: string;
    latexEnabled: boolean;
    options: unknown;
    correctAnswer: string | null;
    explanation: string | null;
    topicId: string;
    topic: { id: string; name: string };
  };
};

function formatNodeQuestion(row: NodeQuestionRow) {
  return {
    id: row.id,
    nodeId: row.nodeId,
    questionId: row.questionId,
    orderIndex: row.orderIndex,
    question: {
      id: row.question.id,
      type: row.question.type,
      difficulty: row.question.difficulty,
      status: row.question.status,
      questionText: row.question.questionText,
      latexEnabled: row.question.latexEnabled,
      options: (row.question.options as Array<{ key: string; text: string }> | null) ?? null,
      correctAnswer: row.question.correctAnswer ?? null,
      explanation: row.question.explanation ?? null,
      topicId: row.question.topicId,
      topic: row.question.topic,
    },
  };
}

/**
 * Resolve a node, the pathway it belongs to, and the owning tutor — used by
 * controllers to authorize question-curation actions.
 */
export async function getNodeForAccess(prisma: PrismaClient, nodeId: string) {
  return prisma.pathwayNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      pathwayId: true,
      pathway: { select: { id: true, tutorId: true, studentId: true, planId: true } },
    },
  });
}

export async function getNodeQuestions(prisma: PrismaClient, nodeId: string) {
  const rows = await prisma.pathwayNodeQuestion.findMany({
    where: { nodeId },
    select: NODE_QUESTION_SELECT,
    orderBy: { orderIndex: "asc" },
  });

  return rows.map(formatNodeQuestion);
}

export async function addQuestionsToNode(
  prisma: PrismaClient,
  nodeId: string,
  questionIds: string[]
) {
  // De-dupe within the request and against questions already in the node.
  const requested = Array.from(new Set(questionIds));

  const existing = await prisma.pathwayNodeQuestion.findMany({
    where: { nodeId },
    select: { questionId: true, orderIndex: true },
  });
  const existingIds = new Set(existing.map((row) => row.questionId));
  const toAdd = requested.filter((id) => !existingIds.has(id));

  if (toAdd.length === 0) {
    return getNodeQuestions(prisma, nodeId);
  }

  // Only attach questions that actually exist (FK would otherwise throw).
  const validQuestions = await prisma.question.findMany({
    where: { id: { in: toAdd } },
    select: { id: true },
  });
  const validIds = new Set(validQuestions.map((q) => q.id));
  const orderedToAdd = toAdd.filter((id) => validIds.has(id));

  if (orderedToAdd.length === 0) {
    return getNodeQuestions(prisma, nodeId);
  }

  const maxOrderIndex = existing.reduce(
    (max, row) => (row.orderIndex > max ? row.orderIndex : max),
    -1
  );

  await prisma.pathwayNodeQuestion.createMany({
    data: orderedToAdd.map((questionId, idx) => ({
      nodeId,
      questionId,
      orderIndex: maxOrderIndex + 1 + idx,
    })),
    skipDuplicates: true,
  });

  return getNodeQuestions(prisma, nodeId);
}

export async function removeQuestionFromNode(
  prisma: PrismaClient,
  nodeId: string,
  questionId: string
) {
  const existing = await prisma.pathwayNodeQuestion.findUnique({
    where: { nodeId_questionId: { nodeId, questionId } },
    select: { id: true },
  });
  if (!existing) throw createHttpError(404, "Question not found in this node");

  await prisma.pathwayNodeQuestion.delete({
    where: { nodeId_questionId: { nodeId, questionId } },
  });
}

export async function reorderNodeQuestions(
  prisma: PrismaClient,
  nodeId: string,
  orderedQuestionIds: string[]
) {
  const existing = await prisma.pathwayNodeQuestion.findMany({
    where: { nodeId },
    select: { questionId: true },
  });
  const existingIds = new Set(existing.map((row) => row.questionId));

  for (const questionId of orderedQuestionIds) {
    if (!existingIds.has(questionId)) {
      throw createHttpError(400, `Question ${questionId} is not in this node`);
    }
  }
  if (orderedQuestionIds.length !== existing.length) {
    throw createHttpError(400, "Reorder must include every question currently in the node");
  }

  await prisma.$transaction(async (tx) => {
    // Two-pass update via a temporary negative offset to dodge the
    // (nodeId, orderIndex) unique constraint while shuffling.
    const offset = orderedQuestionIds.length + 1;

    await Promise.all(
      orderedQuestionIds.map((questionId, idx) =>
        tx.pathwayNodeQuestion.update({
          where: { nodeId_questionId: { nodeId, questionId } },
          data: { orderIndex: -(offset + idx) },
        })
      )
    );

    await Promise.all(
      orderedQuestionIds.map((questionId, idx) =>
        tx.pathwayNodeQuestion.update({
          where: { nodeId_questionId: { nodeId, questionId } },
          data: { orderIndex: idx },
        })
      )
    );
  });

  return getNodeQuestions(prisma, nodeId);
}
