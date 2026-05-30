import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  ListPlansQuery,
  CreatePlanInput,
  UpdatePlanInput,
  AddPlanPathwayInput,
  PlanParams,
  PlanPathwayParams,
} from "./pathway-plans.schema.js";
import {
  createPlan,
  listPlans,
  getPlan,
  updatePlan,
  deletePlan,
  addPathwayToPlan,
  removePathwayFromPlan,
  assertCanAccessPlan,
  assertOwnsPlan,
} from "./pathway-plans.service.js";

export async function createPlanHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as CreatePlanInput;
  const data = await createPlan(request.server.prisma, request.user.sub, body);
  request.log.info({ planId: data.id, createdBy: request.user.sub }, "Pathway plan created");
  return reply.status(201).send({ success: true, message: "Pathway plan created", data });
}

export async function listPlansHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListPlansQuery;
  const { data, meta } = await listPlans(request.server.prisma, request.user, query);
  return reply.send({ success: true, message: "Pathway plans retrieved", data, meta });
}

export async function getPlanHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as PlanParams;

  const plan = await request.server.prisma.pathwayPlan.findUnique({
    where: { id },
    select: { tutorId: true, studentId: true },
  });
  if (!plan) {
    return reply.status(404).send({
      success: false,
      message: "Pathway plan not found",
      statusCode: 404,
    });
  }

  await assertCanAccessPlan(request.server.prisma, request.user, plan);

  const data = await getPlan(request.server.prisma, id);
  return reply.send({ success: true, message: "Pathway plan retrieved", data });
}

export async function updatePlanHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as PlanParams;
  const body = request.body as UpdatePlanInput;

  await assertOwnsPlan(request.server.prisma, request.user, id);

  const data = await updatePlan(request.server.prisma, id, body);
  return reply.send({ success: true, message: "Pathway plan updated", data });
}

export async function deletePlanHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as PlanParams;

  await assertOwnsPlan(request.server.prisma, request.user, id);

  await deletePlan(request.server.prisma, id);
  request.log.info({ planId: id, deletedBy: request.user.sub }, "Pathway plan deleted");
  return reply.send({ success: true, message: "Pathway plan deleted" });
}

export async function addPlanPathwayHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as PlanParams;
  const body = request.body as AddPlanPathwayInput;

  await assertOwnsPlan(request.server.prisma, request.user, id);

  const data = await addPathwayToPlan(request.server.prisma, request.user, id, body);
  return reply.status(201).send({ success: true, message: "Pathway added to plan", data });
}

export async function removePlanPathwayHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id, pathwayId } = request.params as PlanPathwayParams;

  await assertOwnsPlan(request.server.prisma, request.user, id);

  await removePathwayFromPlan(request.server.prisma, id, pathwayId);
  return reply.send({ success: true, message: "Pathway removed from plan" });
}
