import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateRubricBody, ListRubricsQuery, UpdateRubricBody } from "./rubrics.schema.js";
import * as rubricsService from "./rubrics.service.js";

export async function listRubricsHandler(
  req: FastifyRequest<{ Querystring: ListRubricsQuery }>,
  reply: FastifyReply,
) {
  const result = await rubricsService.listRubrics(req.server.prisma, req.query);
  return reply.send({ success: true, message: "Rubrics retrieved", ...result });
}

export async function getRubricHandler(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const rubric = await rubricsService.getRubricById(req.server.prisma, req.params.id);
  return reply.send({ success: true, message: "Rubric retrieved", data: rubric });
}

export async function createRubricHandler(
  req: FastifyRequest<{ Body: CreateRubricBody }>,
  reply: FastifyReply,
) {
  const rubric = await rubricsService.createRubric(req.server.prisma, req.body);
  return reply.code(201).send({ success: true, message: "Rubric created", data: rubric });
}

export async function updateRubricHandler(
  req: FastifyRequest<{ Params: { id: string }; Body: UpdateRubricBody }>,
  reply: FastifyReply,
) {
  const rubric = await rubricsService.updateRubric(req.server.prisma, req.params.id, req.body);
  return reply.send({ success: true, message: "Rubric updated", data: rubric });
}

export async function deactivateRubricHandler(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  await rubricsService.deactivateRubric(req.server.prisma, req.params.id);
  return reply.send({ success: true, message: "Rubric deactivated" });
}

export async function importRubricsHandler(request: FastifyRequest, reply: FastifyReply) {
  const file = await request.file();
  if (!file) {
    return reply.status(400).send({ success: false, message: "CSV file is required" });
  }

  const buffer = await file.toBuffer();
  const result = await rubricsService.importRubrics(request.server.prisma, buffer);

  return reply.send({
    success: true,
    message: `Rubrics import completed: ${result.imported} rubric(s) imported`,
    data: result,
  });
}
