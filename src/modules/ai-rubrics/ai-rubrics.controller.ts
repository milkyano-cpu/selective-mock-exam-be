import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateAiRubricBody, ListAiRubricsQuery, UpdateAiRubricBody } from "./ai-rubrics.schema.js";
import * as aiRubricsService from "./ai-rubrics.service.js";

export async function listAiRubricsHandler(
  req: FastifyRequest<{ Querystring: ListAiRubricsQuery }>,
  reply: FastifyReply,
) {
  const result = await aiRubricsService.listAiRubrics(req.server.prisma, req.query);
  return reply.send({ success: true, message: "AI Rubrics retrieved", ...result });
}

export async function getAiRubricHandler(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const aiRubric = await aiRubricsService.getAiRubricById(req.server.prisma, req.params.id);
  return reply.send({ success: true, message: "AiRubric retrieved", data: aiRubric });
}

export async function createAiRubricHandler(
  req: FastifyRequest<{ Body: CreateAiRubricBody }>,
  reply: FastifyReply,
) {
  const aiRubric = await aiRubricsService.createAiRubric(req.server.prisma, req.body);
  return reply.code(201).send({ success: true, message: "AiRubric created", data: aiRubric });
}

export async function updateAiRubricHandler(
  req: FastifyRequest<{ Params: { id: string }; Body: UpdateAiRubricBody }>,
  reply: FastifyReply,
) {
  const aiRubric = await aiRubricsService.updateAiRubric(req.server.prisma, req.params.id, req.body);
  return reply.send({ success: true, message: "AiRubric updated", data: aiRubric });
}

export async function deactivateAiRubricHandler(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  await aiRubricsService.deactivateAiRubric(req.server.prisma, req.params.id);
  return reply.send({ success: true, message: "AiRubric deactivated" });
}

export async function importAiRubricsHandler(request: FastifyRequest, reply: FastifyReply) {
  const file = await request.file();
  if (!file) {
    return reply.status(400).send({ success: false, message: "CSV file is required" });
  }

  const buffer = await file.toBuffer();
  const result = await aiRubricsService.importAiRubrics(request.server.prisma, buffer);

  return reply.send({
    success: true,
    message: `AI Rubrics import completed: ${result.imported} aiRubric(s) imported`,
    data: result,
  });
}
