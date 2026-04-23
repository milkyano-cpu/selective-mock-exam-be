import type { FastifyRequest, FastifyReply } from "fastify";
import { getMyProfile } from "./users.service.js";

export async function getMe(request: FastifyRequest, reply: FastifyReply) {
  const user = await getMyProfile(request.server.prisma, request.user.sub);
  return reply.status(200).send({
    success: true,
    message: "Profile retrieved successfully",
    data: user,
  });
}
