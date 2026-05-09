import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateCountdownBody,
  ListCountdownsQuery,
  UpdateCountdownBody,
} from "./countdowns.schema.js";
import {
  activateCountdown,
  createCountdown,
  deactivateCountdown,
  deleteCountdown,
  getActiveCountdown,
  listCountdowns,
  updateCountdown,
} from "./countdowns.service.js";

export async function getActiveCountdownHandler(request: FastifyRequest, reply: FastifyReply) {
  const countdown = await getActiveCountdown(request.server.prisma);
  return reply.send({
    success: true,
    message: countdown ? "Active countdown retrieved successfully" : "No active countdown available",
    data: countdown,
  });
}

export async function listCountdownsHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as ListCountdownsQuery;
  const result = await listCountdowns(request.server.prisma, query);
  return reply.send({
    success: true,
    message: "Countdowns retrieved successfully",
    ...result,
  });
}

export async function createCountdownHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as CreateCountdownBody;
  const countdown = await createCountdown(request.server.prisma, body);
  return reply.status(201).send({
    success: true,
    message: "Countdown created successfully",
    data: countdown,
  });
}

export async function updateCountdownHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as UpdateCountdownBody;
  const countdown = await updateCountdown(request.server.prisma, id, body);
  return reply.send({
    success: true,
    message: "Countdown updated successfully",
    data: countdown,
  });
}

export async function activateCountdownHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const countdown = await activateCountdown(request.server.prisma, id);
  return reply.send({
    success: true,
    message: "Countdown activated successfully",
    data: countdown,
  });
}

export async function deactivateCountdownHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const countdown = await deactivateCountdown(request.server.prisma, id);
  return reply.send({
    success: true,
    message: "Countdown deactivated successfully",
    data: countdown,
  });
}

export async function deleteCountdownHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await deleteCountdown(request.server.prisma, id);
  return reply.send({
    success: true,
    message: "Countdown deleted successfully",
  });
}
