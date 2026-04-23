import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient, Role } from "@prisma/client";
import { createHttpError } from "./http-error.js";

export function requireRole(...allowedRoles: Role[]) {
  return async function rolePreHandler(request: FastifyRequest, reply: FastifyReply) {
    const role = request.user?.role as Role | undefined;

    if (!role) {
      return reply.status(401).send({
        success: false,
        message: "Authentication required",
        statusCode: 401,
      });
    }

    if (!allowedRoles.includes(role)) {
      return reply.status(403).send({
        success: false,
        message: "Forbidden",
        statusCode: 403,
      });
    }
  };
}

export async function assertParentOwnsStudent(
  prisma: PrismaClient,
  parentId: string,
  studentId: string
): Promise<void> {
  const relation = await prisma.parentStudentRelation.findUnique({
    where: { parentId_studentId: { parentId, studentId } },
    select: { parentId: true },
  });

  if (!relation) {
    throw createHttpError(403, "Parent is not linked to this student");
  }
}

export async function assertCanAccessStudent(
  prisma: PrismaClient,
  actor: { sub: string; role: string },
  studentId: string
): Promise<void> {
  if (actor.role === "ADMIN" || actor.role === "TUTOR") return;
  if (actor.role === "STUDENT" && actor.sub === studentId) return;
  if (actor.role === "PARENT") {
    await assertParentOwnsStudent(prisma, actor.sub, studentId);
    return;
  }

  throw createHttpError(403, "Forbidden");
}
