import type { FastifyRequest, FastifyReply } from "fastify";
import {
  getMyProfile,
  getMyProfilePhotoAccess,
  uploadMyProfilePhoto,
  softDeleteUser,
  softDeleteChildAccount,
} from "./users.service.js";
import { createHttpError } from "../../utils/http-error.js";

async function readMultipartFileBuffer(request: FastifyRequest) {
  const file = await request.file();

  if (!file) {
    const error = new Error("Profile photo file is required") as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);

  return {
    originalName: file.filename,
    mimeType: file.mimetype,
    size: buffer.byteLength,
    buffer,
  };
}

export async function getMe(request: FastifyRequest, reply: FastifyReply) {
  const user = await getMyProfile(request.server.prisma, request.user.sub);
  return reply.status(200).send({
    success: true,
    message: "Profile retrieved successfully",
    data: user,
  });
}

export async function getMyProfilePhoto(request: FastifyRequest, reply: FastifyReply) {
  const profilePhoto = await getMyProfilePhotoAccess(
    request.server.prisma,
    request.server.storage,
    request.user.sub
  );

  return reply.status(200).send({
    success: true,
    message: "Profile photo retrieved successfully",
    data: {
      ...profilePhoto,
      updatedAt: profilePhoto.updatedAt.toISOString(),
    },
  });
}

export async function deleteMyAccount(request: FastifyRequest, reply: FastifyReply) {
  if (request.user.role === "STUDENT") {
    throw createHttpError(403, "Account deletion must be requested through your parent account.");
  }
  await softDeleteUser(request.server.prisma, request.user.sub);
  return reply.status(200).send({ success: true, message: "Account deleted successfully." });
}

export async function deleteChildAccount(request: FastifyRequest, reply: FastifyReply) {
  const { studentId } = request.params as { studentId: string };
  await softDeleteChildAccount(request.server.prisma, request.user.sub, studentId);
  return reply.status(200).send({ success: true, message: "Student account deleted successfully." });
}

export async function uploadProfilePhoto(request: FastifyRequest, reply: FastifyReply) {
  const file = await readMultipartFileBuffer(request);
  const profilePhoto = await uploadMyProfilePhoto(
    request.server.prisma,
    request.server.storage,
    request.server.redis,
    request.log,
    request.user.sub,
    file
  );

  if (profilePhoto.previousPhotoCleanupFailed) {
    request.log.warn(
      { userId: request.user.sub, profilePhotoKey: profilePhoto.profilePhotoKey },
      "Previous profile photo cleanup failed after replacement"
    );
  }

  return reply.status(200).send({
    success: true,
    message: "Profile photo updated successfully",
    data: {
      signedUrl: profilePhoto.signedUrl,
      originalName: profilePhoto.originalName,
      mimeType: profilePhoto.mimeType,
      size: profilePhoto.size,
      updatedAt: profilePhoto.updatedAt.toISOString(),
      expiresInSeconds: profilePhoto.expiresInSeconds,
      previousPhotoCleanupFailed: profilePhoto.previousPhotoCleanupFailed,
    },
  });
}
