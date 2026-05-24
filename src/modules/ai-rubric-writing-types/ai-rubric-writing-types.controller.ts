import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  WritingTypeParams,
  CreateWritingTypeInput,
  UpdateWritingTypeInput,
} from "./ai-rubric-writing-types.schema.js";
import {
  listWritingTypes as listWritingTypesService,
  getWritingTypeById,
  createWritingType as createWritingTypeService,
  updateWritingType as updateWritingTypeService,
  deleteWritingType as deleteWritingTypeService,
} from "./ai-rubric-writing-types.service.js";

export async function listWritingTypes(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const data = await listWritingTypesService(request.server.prisma);
  return reply.send({
    success: true,
    message: "Writing types retrieved successfully",
    data,
  });
}

export async function getWritingType(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as WritingTypeParams;
  const data = await getWritingTypeById(request.server.prisma, id);
  return reply.send({
    success: true,
    message: "Writing type retrieved successfully",
    data,
  });
}

export async function createWritingType(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body = request.body as CreateWritingTypeInput;
  const data = await createWritingTypeService(request.server.prisma, body);

  request.log.info(
    { writingTypeId: data.id, createdBy: request.user.sub },
    "Writing type created",
  );

  return reply.status(201).send({
    success: true,
    message: "Writing type created successfully",
    data,
  });
}

export async function updateWritingType(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as WritingTypeParams;
  const body = request.body as UpdateWritingTypeInput;
  const data = await updateWritingTypeService(request.server.prisma, id, body);
  return reply.send({
    success: true,
    message: "Writing type updated successfully",
    data,
  });
}

export async function deleteWritingType(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as WritingTypeParams;
  await deleteWritingTypeService(request.server.prisma, id);
  return reply.send({
    success: true,
    message: "Writing type deleted successfully",
  });
}
