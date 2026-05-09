import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";

export interface AiGradeInput {
  questionText: string;
  correctAnswer: string;
  studentAnswer: string;
  rubric?: AiRubricInput | null;
}

export interface AiRubricInput {
  id: string;
  name: string;
  totalMaxScore: number;
  criteria: Array<{
    id: string;
    criterionName: string;
    criterionDescription: string;
    maxScore: number;
    bandDescriptors: Array<{
      scoreMin: number;
      scoreMax: number;
      descriptor: string;
    }>;
  }>;
}

export interface AiCriterionScore {
  criterionId: string;
  criterionName: string;
  score: number;
  maxScore: number;
  feedback: string;
}

export interface AiGradeResult {
  isCorrect: boolean;
  confidence: "high" | "medium" | "low";
  feedback: string;
  gradedAt: string;
  rubric?: {
    id: string;
    name: string;
    totalMaxScore: number;
  };
  criterionScores?: AiCriterionScore[];
  totalAwardedMarks?: number;
  totalPossibleMarks?: number;
  scorePercent?: number;
}

/**
 * Use Claude to evaluate whether a student's essay answer is correct.
 * Returns null if ANTHROPIC_API_KEY is not configured.
 */
export async function gradeEssayWithAi(
  input: AiGradeInput,
): Promise<AiGradeResult | null> {
  if (!env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const rubricBlock = input.rubric
    ? `RUBRIC:
${JSON.stringify({
  id: input.rubric.id,
  name: input.rubric.name,
  totalMaxScore: input.rubric.totalMaxScore,
  criteria: input.rubric.criteria.map((criterion) => ({
    criterionId: criterion.id,
    criterionName: criterion.criterionName,
    criterionDescription: criterion.criterionDescription,
    maxScore: criterion.maxScore,
    bandDescriptors: criterion.bandDescriptors,
  })),
}, null, 2)}
`
    : "";

  const prompt = input.rubric
    ? `You are an essay examiner. Score the student's answer using the rubric exactly.

QUESTION:
${input.questionText}

REFERENCE ANSWER / TEACHER NOTES (may be blank):
${input.correctAnswer}

STUDENT'S ANSWER:
${input.studentAnswer}

${rubricBlock}
GRADING RULES:
- Award an integer score for each criterion from 0 to that criterion's maxScore.
- Use band descriptors as guidance. If a descriptor range applies, choose the best integer score inside that range.
- Do not exceed each criterion maxScore.
- totalAwardedMarks must equal the sum of criterion scores.
- totalPossibleMarks must equal the rubric totalMaxScore.
- isCorrect should be true when scorePercent is at least 50.
- confidence should reflect how confidently the rubric was applied.

Respond with a JSON object ONLY (no markdown, no extra text):
{
  "criterionScores": [
    {
      "criterionId": "criterion id from rubric",
      "criterionName": "criterion name from rubric",
      "score": integer,
      "maxScore": integer,
      "feedback": "Specific feedback for this criterion."
    }
  ],
  "totalAwardedMarks": integer,
  "totalPossibleMarks": integer,
  "scorePercent": number from 0 to 100,
  "isCorrect": true or false,
  "confidence": "high" or "medium" or "low",
  "feedback": "Overall feedback in two or three sentences."
}`
    : `You are an exam grader. Evaluate whether the student's answer is correct based on the reference answer.

QUESTION:
${input.questionText}

REFERENCE ANSWER (the correct answer as set by the teacher):
${input.correctAnswer}

STUDENT'S ANSWER:
${input.studentAnswer}

GRADING RULES:
- A short but accurate answer can be CORRECT even if the reference answer is more detailed.
- The student does not need to match the exact wording — correct concept = correct.
- An answer is INCORRECT if it contradicts the reference answer, is completely off-topic, or is blank/gibberish.
- Partial answers that cover the core concept should be marked CORRECT.

Respond with a JSON object ONLY (no markdown, no extra text):
{
  "isCorrect": true or false,
  "confidence": "high" or "medium" or "low",
  "feedback": "One or two sentences explaining the verdict."
}`;

  try {
    const maxTokens = input.rubric
      ? Math.max(1024, input.rubric.criteria.length * 300 + 256)
      : 512;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("");

    const parsed = JSON.parse(text.trim()) as {
      isCorrect: boolean;
      confidence: "high" | "medium" | "low";
      feedback: string;
      criterionScores?: Array<{
        criterionId: string;
        criterionName: string;
        score: number;
        maxScore: number;
        feedback: string;
      }>;
      totalAwardedMarks?: number;
      totalPossibleMarks?: number;
      scorePercent?: number;
    };

    if (input.rubric) {
      const criterionById = new Map(input.rubric.criteria.map((criterion) => [criterion.id, criterion]));
      const criterionScores = input.rubric.criteria.map((criterion) => {
        const raw = parsed.criterionScores?.find((score) => score.criterionId === criterion.id);
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
        };
      });

      const totalAwardedMarks = criterionScores.reduce((sum, criterion) => sum + criterion.score, 0);
      const totalPossibleMarks = input.rubric.totalMaxScore;
      const scorePercent = totalPossibleMarks > 0 ? (totalAwardedMarks / totalPossibleMarks) * 100 : 0;

      return {
        isCorrect: scorePercent >= 50,
        confidence: parsed.confidence ?? "medium",
        feedback: parsed.feedback ?? "",
        gradedAt: new Date().toISOString(),
        rubric: {
          id: input.rubric.id,
          name: input.rubric.name,
          totalMaxScore: input.rubric.totalMaxScore,
        },
        criterionScores: criterionScores.filter((score) => criterionById.has(score.criterionId)),
        totalAwardedMarks,
        totalPossibleMarks,
        scorePercent,
      };
    }

    return {
      isCorrect: Boolean(parsed.isCorrect),
      confidence: parsed.confidence ?? "medium",
      feedback: parsed.feedback ?? "",
      gradedAt: new Date().toISOString(),
    };
  } catch {
    // If AI fails (network, parse error, etc.), return null so caller can handle gracefully
    return null;
  }
}
