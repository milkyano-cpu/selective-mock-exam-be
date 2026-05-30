import type { FastifyRequest, FastifyReply } from "fastify";
import { assertCanAccessStudent } from "../../utils/authz.js";
import { createHttpError } from "../../utils/http-error.js";
import type {
  ListPathwaysQuery,
  CreatePathwayInput,
  AddNodeInput,
  ReorderNodesInput,
  PathwayParams,
  PathwayNodeParams,
  NodeOnlyParams,
  NodeQuestionParams,
  UpdateProgressInput,
  AddNodeQuestionsInput,
  ReorderNodeQuestionsInput,
} from "./pathways.schema.js";
import {
  listPathways,
  getPathwayDetail,
  createPathway,
  deletePathway,
  addNode,
  removeNode,
  reorderNodes,
  startNodePractice,
  updateNodeProgress,
  getNodeForAccess,
  getNodeQuestions,
  addQuestionsToNode,
  removeQuestionFromNode,
  reorderNodeQuestions,
} from "./pathways.service.js";

/**
 * Curating node questions is a tutor/admin action. Tutors may only touch nodes
 * that belong to a pathway they own. Returns the resolved node for reuse.
 */
async function assertCanCurateNode(
  request: FastifyRequest,
  nodeId: string
) {
  const node = await getNodeForAccess(request.server.prisma, nodeId);
  if (!node) {
    throw createHttpError(404, "Node not found");
  }

  const { role, sub } = request.user;
  if (role !== "ADMIN" && node.pathway.tutorId !== sub) {
    throw createHttpError(403, "You do not have access to this node");
  }

  return node;
}

export async function listPathwaysHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListPathwaysQuery;
  const studentId = query.studentId ?? request.user.sub;
  await assertCanAccessStudent(request.server.prisma, request.user, studentId);

  const data = await listPathways(request.server.prisma, studentId);
  return reply.send({ success: true, message: "Pathways retrieved", data });
}

export async function getPathwayHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as PathwayParams;

  const pathway = await request.server.prisma.studentPathway.findUnique({
    where: { id },
    select: { studentId: true },
  });
  if (!pathway) {
    return reply.status(404).send({
      success: false,
      message: "Pathway not found",
      statusCode: 404,
    });
  }

  await assertCanAccessStudent(request.server.prisma, request.user, pathway.studentId);

  const data = await getPathwayDetail(
    request.server.prisma,
    id,
    pathway.studentId
  );
  return reply.send({ success: true, message: "Pathway retrieved", data });
}

export async function createPathwayHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as CreatePathwayInput;
  const data = await createPathway(request.server.prisma, request.user, body);
  request.log.info({ pathwayId: data.id, createdBy: request.user.sub }, "Pathway created");
  return reply.status(201).send({ success: true, message: "Pathway created", data });
}

export async function deletePathwayHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as PathwayParams;
  await deletePathway(request.server.prisma, id);
  request.log.info({ pathwayId: id, deletedBy: request.user.sub }, "Pathway deleted");
  return reply.send({ success: true, message: "Pathway deleted" });
}

export async function addNodeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as PathwayParams;
  const body = request.body as AddNodeInput;

  const pathway = await request.server.prisma.studentPathway.findUnique({
    where: { id },
    select: { studentId: true },
  });
  if (!pathway) {
    return reply.status(404).send({
      success: false,
      message: "Pathway not found",
      statusCode: 404,
    });
  }

  const data = await addNode(request.server.prisma, id, pathway.studentId, body);
  return reply.status(201).send({ success: true, message: "Node added to pathway", data });
}

export async function removeNodeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id, nodeId } = request.params as PathwayNodeParams;
  await removeNode(request.server.prisma, id, nodeId);
  return reply.send({ success: true, message: "Node removed from pathway" });
}

export async function reorderNodesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as PathwayParams;
  const body = request.body as ReorderNodesInput;

  const pathway = await request.server.prisma.studentPathway.findUnique({
    where: { id },
    select: { studentId: true },
  });
  if (!pathway) {
    return reply.status(404).send({
      success: false,
      message: "Pathway not found",
      statusCode: 404,
    });
  }

  const data = await reorderNodes(request.server.prisma, id, pathway.studentId, body);
  return reply.send({ success: true, message: "Nodes reordered", data });
}

export async function startPracticeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id, nodeId } = request.params as PathwayNodeParams;
  const data = await startNodePractice(
    request.server.prisma,
    id,
    nodeId,
    request.user.sub
  );
  return reply.status(201).send({
    success: true,
    message: "Practice session started",
    data,
  });
}

export async function updateProgressHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id, nodeId } = request.params as PathwayNodeParams;
  const body = request.body as UpdateProgressInput;

  const pathway = await request.server.prisma.studentPathway.findUnique({
    where: { id },
    select: { studentId: true },
  });
  if (!pathway) {
    return reply.status(404).send({
      success: false,
      message: "Pathway not found",
      statusCode: 404,
    });
  }

  await assertCanAccessStudent(request.server.prisma, request.user, pathway.studentId);

  const data = await updateNodeProgress(
    request.server.prisma,
    id,
    nodeId,
    pathway.studentId,
    body
  );
  return reply.send({ success: true, message: "Progress updated", data });
}

// ── Node question curation handlers (SME-111) ─────────────────────────────────

export async function listNodeQuestionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { nodeId } = request.params as NodeOnlyParams;
  await assertCanCurateNode(request, nodeId);

  const data = await getNodeQuestions(request.server.prisma, nodeId);
  return reply.send({ success: true, message: "Node questions retrieved", data });
}

export async function addNodeQuestionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { nodeId } = request.params as NodeOnlyParams;
  const body = request.body as AddNodeQuestionsInput;
  await assertCanCurateNode(request, nodeId);

  const data = await addQuestionsToNode(request.server.prisma, nodeId, body.questionIds);
  request.log.info(
    { nodeId, count: body.questionIds.length, by: request.user.sub },
    "Questions added to pathway node"
  );
  return reply.status(201).send({ success: true, message: "Questions added to node", data });
}

export async function removeNodeQuestionHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { nodeId, questionId } = request.params as NodeQuestionParams;
  await assertCanCurateNode(request, nodeId);

  await removeQuestionFromNode(request.server.prisma, nodeId, questionId);
  return reply.send({ success: true, message: "Question removed from node" });
}

export async function reorderNodeQuestionsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { nodeId } = request.params as NodeOnlyParams;
  const body = request.body as ReorderNodeQuestionsInput;
  await assertCanCurateNode(request, nodeId);

  const data = await reorderNodeQuestions(
    request.server.prisma,
    nodeId,
    body.orderedQuestionIds
  );
  return reply.send({ success: true, message: "Node questions reordered", data });
}
