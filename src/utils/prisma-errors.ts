import { Prisma } from "@prisma/client";
import { createHttpError, type HttpError } from "./http-error.js";

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export function mapPrismaError(error: unknown): HttpError | null {
  if (isUniqueConstraintError(error)) {
    return createHttpError(409, "Resource already exists");
  }

  return null;
}
