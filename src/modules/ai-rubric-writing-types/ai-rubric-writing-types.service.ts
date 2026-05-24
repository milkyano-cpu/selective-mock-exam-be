import type { PrismaClient } from "@prisma/client";
import { createHttpError } from "../../utils/http-error.js";
import type {
  CreateWritingTypeInput,
  UpdateWritingTypeInput,
} from "./ai-rubric-writing-types.schema.js";

function serialize(record: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function listWritingTypes(prisma: PrismaClient) {
  const records = await prisma.aiRubricWritingType.findMany({
    orderBy: { name: "asc" },
  });
  return records.map(serialize);
}

export async function getWritingTypeById(prisma: PrismaClient, id: string) {
  const record = await prisma.aiRubricWritingType.findUnique({ where: { id } });
  if (!record) throw createHttpError(404, "Writing type not found");
  return serialize(record);
}

export async function findWritingTypeByName(
  prisma: PrismaClient,
  name: string,
) {
  return prisma.aiRubricWritingType.findUnique({
    where: { name: name.trim().toUpperCase() },
    select: { id: true, name: true },
  });
}

export async function createWritingType(
  prisma: PrismaClient,
  input: CreateWritingTypeInput,
) {
  const name = input.name.trim().toUpperCase();
  const existing = await prisma.aiRubricWritingType.findUnique({
    where: { name },
  });
  if (existing) {
    throw createHttpError(409, `Writing type "${name}" already exists`);
  }

  const created = await prisma.aiRubricWritingType.create({
    data: { name },
  });
  return serialize(created);
}

export async function updateWritingType(
  prisma: PrismaClient,
  id: string,
  input: UpdateWritingTypeInput,
) {
  const name = input.name.trim().toUpperCase();
  const existing = await prisma.aiRubricWritingType.findUnique({ where: { id } });
  if (!existing) throw createHttpError(404, "Writing type not found");

  if (existing.name !== name) {
    const conflict = await prisma.aiRubricWritingType.findUnique({ where: { name } });
    if (conflict) {
      throw createHttpError(409, `Writing type "${name}" already exists`);
    }
  }

  const updated = await prisma.aiRubricWritingType.update({
    where: { id },
    data: { name },
  });
  return serialize(updated);
}

export async function deleteWritingType(prisma: PrismaClient, id: string) {
  const existing = await prisma.aiRubricWritingType.findUnique({ where: { id } });
  if (!existing) throw createHttpError(404, "Writing type not found");

  // Block deletion if any question or rubric still references this writing type
  const [questionCount, rubricCount] = await Promise.all([
    prisma.question.count({ where: { writingType: existing.name } }),
    prisma.aiRubric.count({ where: { writingType: existing.name } }),
  ]);

  if (questionCount > 0 || rubricCount > 0) {
    throw createHttpError(
      409,
      `Cannot delete "${existing.name}" while ${questionCount} question(s) and ${rubricCount} rubric(s) still reference it`,
    );
  }

  await prisma.aiRubricWritingType.delete({ where: { id } });
}

export async function assertWritingTypeAllowed(
  prisma: PrismaClient,
  name: string | null | undefined,
) {
  if (!name) return null;
  const found = await findWritingTypeByName(prisma, name);
  if (!found) {
    throw createHttpError(
      400,
      `Writing type "${name}" is not registered. Available writing types must be created in the AI Rubric Writing Types table first.`,
    );
  }
  return found.name;
}
