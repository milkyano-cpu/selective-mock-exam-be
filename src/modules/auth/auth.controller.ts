import { randomUUID } from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { RegisterInput, LoginInput, RefreshInput, ChangePasswordInput } from "./auth.schema.js";
import {
  registerParentWithStudents,
  loginUser,
  findUserById,
  invalidatePreviousSessions,
  createRefreshToken,
  rotateRefreshToken,
  revokeSession,
  changeUserPassword,
} from "./auth.service.js";
import { env } from "../../config/env.js";
import {
  sendParentWelcomeEmail,
  sendStudentWelcomeEmail,
} from "../../lib/email.js";
import { normalizeEmail } from "../../utils/normalize.js";

export async function register(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as RegisterInput;

  const { parent, students } = await registerParentWithStudents(
    request.server.prisma,
    body
  );

  // Send credential emails — failures are logged but do not fail the registration.
  // The accounts already exist in the DB; admin can resend or user can use forgot-password.
  const emailResults = await Promise.allSettled([
    sendParentWelcomeEmail({
      to: parent.email,
      fullName: parent.fullName,
      password: parent.password,
      studentNames: students.map((s) => s.fullName),
    }),
    ...students.map((s) =>
      sendStudentWelcomeEmail({
        to: s.email,
        fullName: s.fullName,
        password: s.password,
        parentName: parent.fullName,
      })
    ),
  ]);

  emailResults.forEach((res, i) => {
    if (res.status === "rejected") {
      const target = i === 0 ? parent.email : students[i - 1]!.email;
      request.log.error({ error: res.reason, target }, "Failed to send welcome email");
    }
  });

  return reply.status(201).send({
    success: true,
    message: "Registration successful. Login credentials have been emailed to all accounts.",
    data: {
      parent: { id: parent.id, email: parent.email, fullName: parent.fullName },
      students: students.map((s) => ({
        id: s.id,
        email: s.email,
        fullName: s.fullName,
      })),
    },
  });
}

export async function login(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as LoginInput;

  request.log.info({ email: normalizeEmail(body.email) }, "Login attempt");

  const user = await loginUser(request.server.prisma, body);

  await invalidatePreviousSessions(request.server.prisma, user.id);

  const jti = randomUUID();
  const accessToken = await reply.jwtSign({
    sub: user.id,
    email: user.email,
    role: user.role,
    jti,
  });

  const refreshToken = await createRefreshToken(
    request.server.prisma,
    user.id,
    jti,
    env.REFRESH_TOKEN_EXPIRES_IN
  );

  request.log.info({ userId: user.id, role: user.role }, "Login successful");

  return reply.status(200).send({
    success: true,
    message: "Login successful",
    data: {
      user,
      accessToken,
      refreshToken,
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });
}

export async function refresh(request: FastifyRequest, reply: FastifyReply) {
  const { refreshToken } = request.body as RefreshInput;

  const jti = randomUUID();

  const { newRefreshToken, userId } = await rotateRefreshToken(
    request.server.prisma,
    refreshToken,
    jti,
    env.REFRESH_TOKEN_EXPIRES_IN
  );

  const user = await findUserById(request.server.prisma, userId);

  const accessToken = await reply.jwtSign({
    sub: user.id,
    email: user.email,
    role: user.role,
    jti,
  });

  request.log.info({ userId }, "Token refreshed");

  return reply.status(200).send({
    success: true,
    message: "Token refreshed successfully",
    data: {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  await revokeSession(request.server.prisma, request.user.jti);

  request.log.info({ userId: request.user.sub }, "User logged out");

  return reply.status(200).send({
    success: true,
    message: "Logged out successfully",
  });
}

export async function changePassword(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as ChangePasswordInput;

  await changeUserPassword(
    request.server.prisma,
    request.user.sub,
    body,
    request.user.jti
  );

  request.log.info({ userId: request.user.sub }, "User changed password");

  return reply.status(200).send({
    success: true,
    message: "Password changed successfully. Other active sessions have been logged out.",
  });
}
