import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../config/env.js";

export interface AiGradeInput {
  writingType: string | null;
  questionText: string;
  promptText: string | null;
  /**
   * Pre-resolved prompt images (base64-encoded). Caller is responsible for
   * fetching the bytes from object storage and converting to base64 via
   * `resolveImagesAsBase64` in images.service. Empty/undefined means no
   * image prompts.
   */
  images?: Array<{ data: string; mediaType: string }> | null;
  markingGuide?: string | null;
  studentAnswer: string;
  aiRubric: AiRubricInput;
}

export interface AiRubricInput {
  id: string;
  name: string;
  totalMaxScore: number;
  bandDescriptors: Array<{
    bandLabel: string;
    scoreMin: number;
    scoreMax: number;
    descriptor: string;
  }>;
  calibrationNotes: Array<{
    category: string | null;
    instruction: string;
  }>;
  criteria: Array<{
    id: string;
    criterionName: string;
    criterionDescription: string;
    maxScore: number;
    highScoringIndicators: string[];
    lowScoringIndicators: string[];
    aiCalibrationNotes: string[];
  }>;
}

export interface AiCriterionScore {
  criterionId: string;
  criterionName: string;
  score: number;
  maxScore: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
}

export interface AiGradeResult {
  isCorrect: boolean;
  confidence: "high" | "medium" | "low";
  overallFeedback: string;
  strengths: string[];
  improvements: string[];
  gradedAt: string;
  aiModel: string;
  aiRubric: {
    id: string;
    name: string;
    totalMaxScore: number;
  };
  criterionScores: AiCriterionScore[];
  totalAwardedMarks: number;
  totalPossibleMarks: number;
  scorePercent: number;
  bandLabel: string | null;
  bandDescriptor: string | null;
}

const aiCriterionScoreSchema = z.object({
  criterionId: z.string(),
  criterionName: z.string().optional(),
  score: z.number(),
  maxScore: z.number().optional(),
  feedback: z.string().optional(),
  strengths: z.array(z.string()).optional(),
  improvements: z.array(z.string()).optional(),
});

// JSON shape returned by the AI. Per final-design the array key is `criteria`.
// Accept legacy `criterionScores` too for backward compatibility, then
// normalise below.
const aiGradeResponseSchema = z.object({
  criteria: z.array(aiCriterionScoreSchema).optional(),
  criterionScores: z.array(aiCriterionScoreSchema).optional(),
  overall_feedback: z.string(),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function findBand(
  scorePercent: number,
  bands: AiRubricInput["bandDescriptors"],
) {
  return bands.find((band) => scorePercent >= band.scoreMin && scorePercent <= band.scoreMax) ?? null;
}

export function buildEssayAiFeedback(result: AiGradeResult) {
  return {
    overallFeedback: result.overallFeedback,
    strengths: result.strengths,
    improvements: result.improvements,
    confidence: result.confidence,
    gradedAt: result.gradedAt,
    aiModel: result.aiModel,
    aiRubric: result.aiRubric,
    totalAwardedMarks: result.totalAwardedMarks,
    totalPossibleMarks: result.totalPossibleMarks,
    scorePercent: result.scorePercent,
    bandLabel: result.bandLabel,
    bandDescriptor: result.bandDescriptor,
    criterionScores: result.criterionScores,
  };
}

export async function gradeEssayWithAi(input: AiGradeInput): Promise<AiGradeResult> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!env.ANTHROPIC_GRADING_MODEL) {
    throw new Error("ANTHROPIC_GRADING_MODEL is not configured (set it in .env)");
  }
  if (!env.ANTHROPIC_GRADING_TIMEOUT_MS) {
    throw new Error("ANTHROPIC_GRADING_TIMEOUT_MS is not configured (set it in .env)");
  }
  if (env.ANTHROPIC_GRADING_MAX_RETRIES === undefined) {
    throw new Error("ANTHROPIC_GRADING_MAX_RETRIES is not configured (set it in .env)");
  }

  if (!input.aiRubric || input.aiRubric.criteria.length === 0) {
    throw new Error("AI rubric with criteria is required for essay grading");
  }

  const aiModel = env.ANTHROPIC_GRADING_MODEL;
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: env.ANTHROPIC_GRADING_TIMEOUT_MS,
    maxRetries: env.ANTHROPIC_GRADING_MAX_RETRIES,
  });

  // Filter calibration notes: keep only General + notes matching the writing type.
  // Categories are stored as strings like "General", "Creative", "Persuasive".
  // Matching is case-insensitive against input.writingType (e.g. "CREATIVE").
  const normalizedWritingType = input.writingType?.trim().toUpperCase() ?? null;
  const relevantCalibrationNotes = input.aiRubric.calibrationNotes.filter((note) => {
    const cat = note.category?.trim().toUpperCase() ?? "";
    if (cat === "GENERAL") return true;
    if (normalizedWritingType && cat === normalizedWritingType) return true;
    return false;
  });

  const rubricPayload = {
    id: input.aiRubric.id,
    name: input.aiRubric.name,
    totalMaxScore: input.aiRubric.totalMaxScore,
    bandDescriptors: input.aiRubric.bandDescriptors,
    calibrationNotes: relevantCalibrationNotes,
    criteria: input.aiRubric.criteria.map((criterion) => ({
      criterionId: criterion.id,
      criterionName: criterion.criterionName,
      criterionDescription: criterion.criterionDescription,
      maxScore: criterion.maxScore,
      highScoringIndicators: criterion.highScoringIndicators,
      lowScoringIndicators: criterion.lowScoringIndicators,
      aiCalibrationNotes: criterion.aiCalibrationNotes,
    })),
  };

  // --- Prompt caching strategy (per final-design Step 4) ---
  // Anthropic cache_control markers create cache breakpoints. We use 3 markers
  // hierarchically:
  //   1. system prompt   → cached (stable across all grading)
  //   2. RUBRIC block    → cached per rubric_id (sections 1-3)
  //   3. QUESTION block  → cached per question_id (sections 4-7, incl. images)
  //   4. STUDENT block   → NEVER cached (section 8)
  //
  // Hierarchy means: same rubric different question → rubric portion still HIT.
  const systemPrompt = `You are an examiner grading a selective entry Writing essay. Use the rubric data exactly and return JSON only.

RULES:
- Score every criterion from 0 to that criterion's maxScore.
- Do not invent criteria or omit criteria.
- Use calibration notes, high/low indicators, and band descriptors as grading guidance.
- total score will be calculated by the application from criterion scores; do not scale it yourself.
- Be specific, constructive, and age-appropriate.

Respond with a JSON object only:
{
  "overall_feedback": "Overall feedback for the student.",
  "strengths": ["short strength"],
  "improvements": ["short improvement"],
  "confidence": "high",
  "criteria": [
    {
      "criterionId": "criterion id from RUBRIC_JSON",
      "criterionName": "criterion name from RUBRIC_JSON",
      "score": 0,
      "maxScore": 5,
      "feedback": "Specific criterion feedback.",
      "strengths": ["criterion strength"],
      "improvements": ["criterion improvement"]
    }
  ]
}`;

  // Block A — RUBRIC (sections 1-3): cacheable per rubric_id
  const rubricBlock = [
    `RUBRIC_JSON:\n${JSON.stringify(rubricPayload, null, 2)}`,
    `WRITING_TYPE:\n${input.writingType ?? "UNSPECIFIED"}`,
  ].join("\n\n");

  // Block B — QUESTION (sections 4-7): cacheable per question_id
  const questionTextBlock = [
    `QUESTION_TEXT:\n${input.questionText}`,
    input.promptText?.trim() ? `PROMPT_TEXT:\n${input.promptText}` : null,
    input.markingGuide ? `MARKING_GUIDE:\n${input.markingGuide}` : null,
  ].filter(Boolean).join("\n\n");

  // Block C — STUDENT (section 8): never cached
  const studentSection = `STUDENT_RESPONSE:\n${input.studentAnswer}`;

  // Assemble user content blocks. Cache marker goes on the LAST block of each
  // cacheable group so Anthropic caches everything up to and including it.
  type ContentBlock =
    | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
    | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string }; cache_control?: { type: "ephemeral" } };

  const userContent: ContentBlock[] = [];

  // 1. Rubric block — always end of rubric cache region
  userContent.push({
    type: "text",
    text: rubricBlock,
    cache_control: { type: "ephemeral" },
  });

  // 2. Question text — only mark as cache end if no images follow
  const hasImages = (input.images?.length ?? 0) > 0;
  userContent.push({
    type: "text",
    text: questionTextBlock,
    ...(hasImages ? {} : { cache_control: { type: "ephemeral" as const } }),
  });

  // 3. Images — last one carries the cache marker (= end of question region)
  if (hasImages && input.images) {
    input.images.forEach((img, i) => {
      const isLast = i === input.images!.length - 1;
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: img.data,
        },
        ...(isLast ? { cache_control: { type: "ephemeral" as const } } : {}),
      });
    });
  }

  // 4. Student response — NO cache_control (section 8 must never be cached)
  userContent.push({
    type: "text",
    text: studentSection,
  });

  const message = await client.messages.create({
    model: aiModel,
    max_tokens: Math.max(1200, input.aiRubric.criteria.length * 350 + 500),
    system: [
      {
        type: "text" as const,
        text: systemPrompt,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const text = message.content
    .filter((content) => content.type === "text")
    .map((content) => (content as { type: "text"; text: string }).text)
    .join("");

  let parsed: z.infer<typeof aiGradeResponseSchema>;
  try {
    parsed = aiGradeResponseSchema.parse(JSON.parse(extractJsonObject(text)));
  } catch (parseError) {
    const snippet = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    throw new Error(`AI grading returned malformed JSON. Raw response: ${snippet}`);
  }
  // Prefer design-named `criteria`; fall back to legacy `criterionScores`.
  const rawCriteria = parsed.criteria ?? parsed.criterionScores ?? [];
  if (rawCriteria.length === 0) {
    throw new Error("AI grading response missing 'criteria' array");
  }
  const rawByCriterionId = new Map(rawCriteria.map((score) => [score.criterionId, score]));

  const criterionScores = input.aiRubric.criteria.map((criterion) => {
    const raw = rawByCriterionId.get(criterion.id);
    const score = Math.min(
      criterion.maxScore,
      Math.max(0, Number.isFinite(raw?.score) ? Math.round(raw!.score) : 0),
    );

    return {
      criterionId: criterion.id,
      criterionName: raw?.criterionName ?? criterion.criterionName,
      score,
      maxScore: criterion.maxScore,
      feedback: raw?.feedback ?? "",
      strengths: raw?.strengths ?? [],
      improvements: raw?.improvements ?? [],
    };
  });

  const totalAwardedMarks = criterionScores.reduce((sum, criterion) => sum + criterion.score, 0);
  const totalPossibleMarks = input.aiRubric.totalMaxScore;
  const scorePercent = totalPossibleMarks > 0 ? (totalAwardedMarks / totalPossibleMarks) * 100 : 0;
  const band = findBand(scorePercent, input.aiRubric.bandDescriptors);

  return {
    isCorrect: false,
    confidence: parsed.confidence,
    overallFeedback: parsed.overall_feedback,
    strengths: parsed.strengths,
    improvements: parsed.improvements,
    gradedAt: new Date().toISOString(),
    aiModel,
    aiRubric: {
      id: input.aiRubric.id,
      name: input.aiRubric.name,
      totalMaxScore: input.aiRubric.totalMaxScore,
    },
    criterionScores,
    totalAwardedMarks,
    totalPossibleMarks,
    scorePercent,
    bandLabel: band?.bandLabel ?? null,
    bandDescriptor: band?.descriptor ?? null,
  };
}
