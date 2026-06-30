import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  CreateStaffInput,
  ListTutorsQuery,
  ListUsersQuery,
  TutorParams,
  UpdateTutorInput,
  UpdateTutorStatusInput,
  UserParams,
} from "./admin.schema.js";
import {
  createStaffAccount,
  listUsers as listUsersService,
  syncUserTier,
  listTutors as listTutorsService,
  getTutorById,
  updateTutor as updateTutorService,
  updateTutorStatus as updateTutorStatusService,
  deleteTutor as deleteTutorService,
  deleteUserById,
  updateUserById,
  updateUserStatusById,
} from "./admin.service.js";
import { getAdminDashboardStats } from "./admin-stats.service.js";
import { sendStaffWelcomeEmail } from "../../lib/email.js";

export async function getAdminStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const stats = await getAdminDashboardStats(request.server.prisma);
  return reply.send({
    success: true,
    message: "Admin dashboard stats retrieved",
    data: stats,
  });
}

export async function createStaff(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = request.body as CreateStaffInput;

  const { user, password, passwordGenerated } = await createStaffAccount(
    request.server.prisma,
    body
  );

  let emailSent = true;
  try {
    await sendStaffWelcomeEmail({
      to: user.email,
      fullName: user.fullName,
      role: user.role as "ADMIN" | "TUTOR",
      password,
    });
  } catch (error) {
    emailSent = false;
    request.log.error(
      { error, target: user.email },
      "Failed to send staff welcome email"
    );
  }

  request.log.info(
    { userId: user.id, role: user.role, createdBy: request.user.sub },
    "Staff account created"
  );

  const message = emailSent
    ? `${user.role} account created and credentials emailed`
    : passwordGenerated
      ? `${user.role} account created but welcome email delivery failed`
      : `${user.role} account created but email delivery failed — share credentials manually`;

  return reply.status(201).send({
    success: true,
    message,
    data: {
      user,
      emailSent,
    },
  });
}

export async function listUsersHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListUsersQuery;

  // Tutors can only list students
  if (request.user?.role === "TUTOR" && query.role !== "STUDENT") {
    return reply.status(403).send({
      success: false,
      message: "Forbidden",
      statusCode: 403,
    });
  }

  // Profile fields & parent/student relations are admin-only; tutors get the basic list.
  const result = await listUsersService(request.server.prisma, query, {
    includeAdminFields: request.user?.role === "ADMIN",
  });

  const data = await Promise.all(
    result.data.map(async ({ profilePhotoKey, ...user }) => {
      let photoUrl: string | null = null;
      if (profilePhotoKey) {
        try {
          photoUrl = await request.server.storage.getProfilePhotoSignedUrl(profilePhotoKey);
        } catch {
          // silent — photo unavailable
        }
      }
      return { ...user, photoUrl };
    })
  );

  return reply.send({
    success: true,
    message: "Users retrieved successfully",
    data,
    meta: result.meta,
  });
}

export async function syncAllTiersHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const students = await request.server.prisma.user.findMany({
    where: { role: "STUDENT" },
    select: { id: true },
  });

  await Promise.all(
    students.map((s) => syncUserTier(request.server.prisma, s.id))
  );

  request.log.info({ count: students.length, syncedBy: request.user.sub }, "Bulk tier sync completed");

  return reply.send({
    success: true,
    message: `Synced tier for ${students.length} student(s)`,
  });
}

// ── Tutor CRUD ──────────────────────────────────────────

export async function listTutors(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const query = request.query as ListTutorsQuery;
  const result = await listTutorsService(request.server.prisma, query);

  return reply.send({
    success: true,
    message: "Tutors retrieved successfully",
    ...result,
  });
}

export async function getTutor(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as TutorParams;
  const tutor = await getTutorById(request.server.prisma, id);

  return reply.send({
    success: true,
    message: "Tutor retrieved successfully",
    data: tutor,
  });
}

export async function updateTutor(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as TutorParams;
  const body = request.body as UpdateTutorInput;
  const tutor = await updateTutorService(request.server.prisma, id, body);

  request.log.info(
    { tutorId: id, updatedBy: request.user.sub },
    "Tutor account updated"
  );

  return reply.send({
    success: true,
    message: "Tutor updated successfully",
    data: tutor,
  });
}

export async function updateTutorStatus(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as TutorParams;
  const body = request.body as UpdateTutorStatusInput;
  const tutor = await updateTutorStatusService(request.server.prisma, id, body);

  request.log.info(
    { tutorId: id, newStatus: body.status, updatedBy: request.user.sub },
    "Tutor status updated"
  );

  return reply.send({
    success: true,
    message: `Tutor status changed to ${body.status}`,
    data: tutor,
  });
}

export async function deleteTutor(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as TutorParams;
  await deleteTutorService(request.server.prisma, id);

  request.log.info(
    { tutorId: id, deletedBy: request.user.sub },
    "Tutor account deleted"
  );

  return reply.send({
    success: true,
    message: "Tutor deleted successfully",
  });
}

export async function updateUserHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as UserParams;
  const body = request.body as UpdateTutorInput;
  const user = await updateUserById(request.server.prisma, id, body);

  request.log.info(
    { userId: id, updatedBy: request.user.sub },
    "User profile updated"
  );

  return reply.send({
    success: true,
    message: "User updated successfully",
    data: user,
  });
}

export async function updateUserStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as UserParams;
  const body = request.body as UpdateTutorStatusInput;
  const user = await updateUserStatusById(
    request.server.prisma,
    id,
    body,
    request.user.sub
  );

  request.log.info(
    { userId: id, newStatus: body.status, updatedBy: request.user.sub },
    "User status updated"
  );

  return reply.send({
    success: true,
    message: `User status changed to ${body.status}`,
    data: user,
  });
}

export async function deleteUserHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as { id: string };
  await deleteUserById(request.server.prisma, id);

  request.log.info(
    { userId: id, deletedBy: request.user.sub },
    "User account soft-deleted"
  );

  return reply.send({
    success: true,
    message: "User deleted successfully.",
  });
}
