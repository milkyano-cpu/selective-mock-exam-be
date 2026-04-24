import { randomUUID } from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { RegisterInput, LoginInput, ChangePasswordInput, ForgotPasswordInput, ResetPasswordInput } from "./auth.schema.js";
import {
  registerParentWithStudents,
  loginUser,
  findUserById,
  invalidatePreviousSessions,
  createRefreshToken,
  rotateRefreshToken,
  revokeSession,
  changeUserPassword,
  createPasswordResetToken,
  consumePasswordResetToken,
  validatePasswordResetToken,
} from "./auth.service.js";
import { env } from "../../config/env.js";
import {
  sendParentWelcomeEmail,
  sendStudentWelcomeEmail,
  sendPasswordResetEmail,
} from "../../lib/email.js";
import { normalizeEmail } from "../../utils/normalize.js";
import { createHttpError } from "../../utils/http-error.js";

function parseExpiryToSeconds(expiry: string): number {
  const unit = expiry.at(-1) ?? "";
  const value = parseInt(expiry.slice(0, -1), 10);
  const toSeconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (toSeconds[unit] ?? 0);
}

function parseExpiryToMinutes(expiry: string): number {
  return Math.round(parseExpiryToSeconds(expiry) / 60);
}

function buildCookieOptions(maxAge: number, path: string) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path,
    maxAge,
  };
}

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
      const target = i === 0 ? parent.email : (students[i - 1]?.email ?? "unknown");
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

  reply.setCookie(
    "access_token",
    accessToken,
    buildCookieOptions(parseExpiryToSeconds(env.JWT_EXPIRES_IN), "/")
  );
  reply.setCookie(
    "refresh_token",
    refreshToken,
    buildCookieOptions(
      parseExpiryToSeconds(env.REFRESH_TOKEN_EXPIRES_IN),
      `${env.API_PREFIX}/auth/refresh`
    )
  );

  return reply.status(200).send({
    success: true,
    message: "Login successful",
    data: {
      user,
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });
}

export async function refresh(request: FastifyRequest, reply: FastifyReply) {
  const refreshToken = request.cookies.refresh_token;
  if (!refreshToken) throw createHttpError(401, "Refresh token missing");

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

  reply.setCookie(
    "access_token",
    accessToken,
    buildCookieOptions(parseExpiryToSeconds(env.JWT_EXPIRES_IN), "/")
  );
  reply.setCookie(
    "refresh_token",
    newRefreshToken,
    buildCookieOptions(
      parseExpiryToSeconds(env.REFRESH_TOKEN_EXPIRES_IN),
      `${env.API_PREFIX}/auth/refresh`
    )
  );

  return reply.status(200).send({
    success: true,
    message: "Token refreshed successfully",
    data: {
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  await revokeSession(request.server.prisma, request.user.jti);

  request.log.info({ userId: request.user.sub }, "User logged out");

  reply.clearCookie("access_token", { path: "/" });
  reply.clearCookie("refresh_token", { path: `${env.API_PREFIX}/auth/refresh` });

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

export async function forgotPassword(request: FastifyRequest, reply: FastifyReply) {
  const { email: rawEmail } = request.body as ForgotPasswordInput;
  const email = normalizeEmail(rawEmail);

  const result = await createPasswordResetToken(
    request.server.prisma,
    email,
    env.PASSWORD_RESET_EXPIRES_IN
  );

  if (result) {
    const resetLink = `${env.APP_URL}/reset-password?token=${result.token}`;
    const expiresInMinutes = parseExpiryToMinutes(env.PASSWORD_RESET_EXPIRES_IN);

    try {
      await sendPasswordResetEmail({
        to: email,
        fullName: result.fullName,
        resetLink,
        expiresInMinutes,
      });
    } catch (error) {
      request.log.error({ error, email }, "Failed to send password reset email");
    }

    request.log.info({ email }, "Password reset token generated and emailed");
  }

  // Always return 200 — never reveal whether the email exists
  return reply.status(200).send({
    success: true,
    message: "If that email is registered, a password reset link has been sent to your inbox.",
  });
}

export async function validateResetToken(request: FastifyRequest, reply: FastifyReply) {
  const { token } = request.query as { token: string };
  const valid = await validatePasswordResetToken(request.server.prisma, token);
  return reply.status(200).send({
    success: true,
    data: { valid },
  });
}

export async function resetPassword(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as ResetPasswordInput;

  await consumePasswordResetToken(
    request.server.prisma,
    body.token,
    body.newPassword
  );

  request.log.info("Password reset completed via secure token");

  return reply.status(200).send({
    success: true,
    message: "Password has been reset successfully. Please log in with your new password.",
  });
}
