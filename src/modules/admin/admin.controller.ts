import type { FastifyRequest, FastifyReply } from "fastify";
import type { CreateStaffInput } from "./admin.schema.js";
import { createStaffAccount } from "./admin.service.js";
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
