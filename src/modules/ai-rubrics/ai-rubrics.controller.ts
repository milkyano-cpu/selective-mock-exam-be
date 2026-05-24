import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateAiRubricBody,
  ListAiRubricsQuery,
  UpdateAiRubricBody,
  RubricChildParams,
  RubricIdOnlyParams,
  CreateCriterionInput,
  UpdateCriterionInput,
  CreateBandInput,
  UpdateBandInput,
  CreateCalibrationNoteInput,
  UpdateCalibrationNoteInput,
} from "./ai-rubrics.schema.js";
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

// ── Criteria ───────────────────────────────────────────────────────────────

export async function createCriterionHandler(
  req: FastifyRequest<{ Params: RubricIdOnlyParams; Body: CreateCriterionInput }>,
  reply: FastifyReply,
) {
  const data = await aiRubricsService.createCriterion(req.server.prisma, req.params.rubricId, req.body);
  return reply.code(201).send({ success: true, message: "Criterion created", data });
}

export async function updateCriterionHandler(
  req: FastifyRequest<{ Params: RubricChildParams; Body: UpdateCriterionInput }>,
  reply: FastifyReply,
) {
  const data = await aiRubricsService.updateCriterion(req.server.prisma, req.params.rubricId, req.params.childId, req.body);
  return reply.send({ success: true, message: "Criterion updated", data });
}

export async function deleteCriterionHandler(
  req: FastifyRequest<{ Params: RubricChildParams }>,
  reply: FastifyReply,
) {
  await aiRubricsService.deleteCriterion(req.server.prisma, req.params.rubricId, req.params.childId);
  return reply.send({ success: true, message: "Criterion deleted" });
}

export async function importCriteriaCsvHandler(req: FastifyRequest, reply: FastifyReply) {
  const file = await req.file();
  if (!file) return reply.status(400).send({ success: false, message: "CSV file is required" });
  const buffer = await file.toBuffer();
  const result = await aiRubricsService.importCriteriaCsv(req.server.prisma, buffer);
  return reply.send({ success: true, message: `Criteria import completed: ${result.imported} imported`, data: result });
}

// ── Band Descriptors ───────────────────────────────────────────────────────

export async function createBandHandler(
  req: FastifyRequest<{ Params: RubricIdOnlyParams; Body: CreateBandInput }>,
  reply: FastifyReply,
) {
  const data = await aiRubricsService.createBandDescriptor(req.server.prisma, req.params.rubricId, req.body);
  return reply.code(201).send({ success: true, message: "Band descriptor created", data });
}

export async function updateBandHandler(
  req: FastifyRequest<{ Params: RubricChildParams; Body: UpdateBandInput }>,
  reply: FastifyReply,
) {
  const data = await aiRubricsService.updateBandDescriptor(req.server.prisma, req.params.rubricId, req.params.childId, req.body);
  return reply.send({ success: true, message: "Band descriptor updated", data });
}

export async function deleteBandHandler(
  req: FastifyRequest<{ Params: RubricChildParams }>,
  reply: FastifyReply,
) {
  await aiRubricsService.deleteBandDescriptor(req.server.prisma, req.params.rubricId, req.params.childId);
  return reply.send({ success: true, message: "Band descriptor deleted" });
}

export async function importBandsCsvHandler(req: FastifyRequest, reply: FastifyReply) {
  const file = await req.file();
  if (!file) return reply.status(400).send({ success: false, message: "CSV file is required" });
  const buffer = await file.toBuffer();
  const result = await aiRubricsService.importBandsCsv(req.server.prisma, buffer);
  return reply.send({ success: true, message: `Bands import completed: ${result.imported} imported`, data: result });
}

// ── Calibration Notes ──────────────────────────────────────────────────────

export async function createCalibrationNoteHandler(
  req: FastifyRequest<{ Params: RubricIdOnlyParams; Body: CreateCalibrationNoteInput }>,
  reply: FastifyReply,
) {
  const data = await aiRubricsService.createCalibrationNote(req.server.prisma, req.params.rubricId, req.body);
  return reply.code(201).send({ success: true, message: "Calibration note created", data });
}

export async function updateCalibrationNoteHandler(
  req: FastifyRequest<{ Params: RubricChildParams; Body: UpdateCalibrationNoteInput }>,
  reply: FastifyReply,
) {
  const data = await aiRubricsService.updateCalibrationNote(req.server.prisma, req.params.rubricId, req.params.childId, req.body);
  return reply.send({ success: true, message: "Calibration note updated", data });
}

export async function deleteCalibrationNoteHandler(
  req: FastifyRequest<{ Params: RubricChildParams }>,
  reply: FastifyReply,
) {
  await aiRubricsService.deleteCalibrationNote(req.server.prisma, req.params.rubricId, req.params.childId);
  return reply.send({ success: true, message: "Calibration note deleted" });
}

export async function importCalibrationNotesCsvHandler(req: FastifyRequest, reply: FastifyReply) {
  const file = await req.file();
  if (!file) return reply.status(400).send({ success: false, message: "CSV file is required" });
  const buffer = await file.toBuffer();
  const result = await aiRubricsService.importCalibrationNotesCsv(req.server.prisma, buffer);
  return reply.send({ success: true, message: `Calibration notes import completed: ${result.imported} imported`, data: result });
}
