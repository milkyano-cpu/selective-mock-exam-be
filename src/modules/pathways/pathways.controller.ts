import type { FastifyRequest, FastifyReply } from "fastify";
import { assertCanAccessStudent } from "../../utils/authz.js";
import type {
  ListPathwaysQuery,
  CreatePathwayInput,
  AddNodeInput,
  ReorderNodesInput,
  PathwayParams,
  PathwayNodeParams,
  UpdateProgressInput,
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
} from "./pathways.service.js";

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
  const data = await createPathway(request.server.prisma, request.user.sub, body);
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
