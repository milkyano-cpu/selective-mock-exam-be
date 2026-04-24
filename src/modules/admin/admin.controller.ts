import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  CreateStaffInput,
  ListTutorsQuery,
  TutorParams,
  UpdateTutorInput,
  UpdateTutorStatusInput,
} from "./admin.schema.js";
import {
  createStaffAccount,
  listTutors as listTutorsService,
  getTutorById,
  updateTutor as updateTutorService,
  updateTutorStatus as updateTutorStatusService,
  deleteTutor as deleteTutorService,
} from "./admin.service.js";
import { sendStaffWelcomeEmail } from "../../lib/email.js";

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
    : `${user.role} account created but email delivery failed — share credentials manually`;

  return reply.status(201).send({
    success: true,
    message,
    data: {
      user,
      generatedPassword: passwordGenerated ? password : null,
      emailSent,
    },
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
