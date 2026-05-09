import type { FastifyReply, FastifyRequest } from "fastify";
import { createHttpError } from "../../utils/http-error.js";
import type { CreatePassageBody, ListPassagesQuery, UpdatePassageBody } from "./passages.schema.js";
import * as passagesService from "./passages.service.js";

export async function createPassageHandler(
  req: FastifyRequest<{ Body: CreatePassageBody }>,
  reply: FastifyReply,
) {
  const passage = await passagesService.createPassage(req.server.prisma, req.body);
  return reply.code(201).send({ success: true, message: "Passage created", data: passage });
}

export async function listPassagesHandler(
  req: FastifyRequest<{ Querystring: ListPassagesQuery }>,
  reply: FastifyReply,
) {
  const result = await passagesService.listPassages(req.server.prisma, req.query);
  return reply.send({ success: true, message: "Passages retrieved", ...result });
}

export async function getPassageByIdHandler(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const passage = await passagesService.getPassageById(req.server.prisma, req.params.id);
  return reply.send({ success: true, message: "Passage retrieved", data: passage });
}

export async function updatePassageHandler(
  req: FastifyRequest<{ Params: { id: string }; Body: UpdatePassageBody }>,
  reply: FastifyReply,
) {
  const passage = await passagesService.updatePassage(req.server.prisma, req.params.id, req.body);
  return reply.send({ success: true, message: "Passage updated", data: passage });
}

export async function deletePassageHandler(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  await passagesService.deletePassage(req.server.prisma, req.params.id);
  return reply.send({ success: true, message: "Passage deleted" });
}

export async function importPassagesHandler(req: FastifyRequest, reply: FastifyReply) {
  const data = await req.file();

  if (!data) throw createHttpError(400, "No file uploaded");

  if (!data.filename.endsWith(".csv")) {
    throw createHttpError(400, "Uploaded file must be a CSV");
  }

  const buffer = await data.toBuffer();
  const result = await passagesService.importPassages(req.server.prisma, buffer);

  req.log.info(
    { total: result.total, created: result.created, updated: result.updated, failed: result.failed },
    "Passages import complete",
  );

  return reply.code(200).send({
    success: true,
    message: `Import complete: ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
    data: result,
  });
}
