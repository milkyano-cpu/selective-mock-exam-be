import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

function normalizeConnectionString(url: string): string {
  return url.replace(/sslmode=(prefer|require|verify-ca)/, "sslmode=verify-full");
}

function buildPrisma(): PrismaClient {
  const connectionString =
    process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];

  if (!connectionString) {
    console.error(
      "[seed-rubrics] DATABASE_URL (or DIRECT_URL) must be set in the environment."
    );
    process.exit(1);
  }

  const adapter = new PrismaPg({
    connectionString: normalizeConnectionString(connectionString),
  });

  return new PrismaClient({ adapter, log: ["warn", "error"] });
}

const prisma = buildPrisma();

interface FrameworkCriterion {
  criterionName: string;
  criterionDescription: string;
  maxScore: number;
  sortOrder: number;
  highScoringIndicators: string[];
  lowScoringIndicators: string[];
  aiCalibrationNotes: string[];
}

interface FrameworkBand {
  bandLabel: string;
  scoreMin: number;
  scoreMax: number;
  descriptor: string;
}

interface FrameworkCalibration {
  category: string;
  instruction: string;
  sortOrder: number;
}

interface FrameworkRubric {
  id: string;
  name: string;
  writingType: string;
  totalMaxScore: number;
  isDefault: boolean;
  isActive: boolean;
  criteria: FrameworkCriterion[];
  bandDescriptors: FrameworkBand[];
  calibrationNotes: FrameworkCalibration[];
}

interface FrameworkData {
  rubrics: FrameworkRubric[];
}

async function main(): Promise<void> {
  const filePath = resolve(__dirname, "aspire_writing_ai_marking_framework.json");
  const raw = readFileSync(filePath, "utf-8");
  const framework: FrameworkData = JSON.parse(raw);

  console.log(`[seed-rubrics] Found ${framework.rubrics.length} rubric(s) to seed.`);

  for (const rubric of framework.rubrics) {
    const existing = await prisma.aiRubric.findUnique({ where: { id: rubric.id } });

    if (existing) {
      console.log(`[seed-rubrics] Rubric "${rubric.name}" (${rubric.id}) already exists. Skipping.`);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.aiRubric.create({
        data: {
          id: rubric.id,
          name: rubric.name,
          writingType: rubric.writingType,
          totalMaxScore: rubric.totalMaxScore,
          isDefault: rubric.isDefault,
          isActive: rubric.isActive,
        },
      });

      for (const criterion of rubric.criteria) {
        await tx.aiRubricCriterion.create({
          data: {
            aiRubricId: rubric.id,
            criterionName: criterion.criterionName,
            criterionDescription: criterion.criterionDescription,
            maxScore: criterion.maxScore,
            sortOrder: criterion.sortOrder,
            highScoringIndicators: criterion.highScoringIndicators,
            lowScoringIndicators: criterion.lowScoringIndicators,
            aiCalibrationNotes: criterion.aiCalibrationNotes,
          },
        });
      }

      for (const band of rubric.bandDescriptors) {
        await tx.aiRubricBandDescriptor.create({
          data: {
            aiRubricId: rubric.id,
            bandLabel: band.bandLabel,
            scoreMin: band.scoreMin,
            scoreMax: band.scoreMax,
            descriptor: band.descriptor,
          },
        });
      }

      for (const note of rubric.calibrationNotes) {
        await tx.aiCalibrationNote.create({
          data: {
            aiRubricId: rubric.id,
            category: note.category,
            instruction: note.instruction,
            sortOrder: note.sortOrder,
          },
        });
      }

      console.log(`[seed-rubrics] Created rubric "${rubric.name}" with ${rubric.criteria.length} criteria, ${rubric.bandDescriptors.length} bands, ${rubric.calibrationNotes.length} calibration notes.`);
    });
  }

  console.log("[seed-rubrics] Done.");
}

main()
  .catch((error: unknown) => {
    console.error("[seed-rubrics] Failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
