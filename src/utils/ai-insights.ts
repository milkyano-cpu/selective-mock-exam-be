import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";

export interface SessionAiInsightInput {
  examTitle: string;
  totalQuestions: number;
  correctCount: number;
  totalTimeSeconds: number;
  answers: Array<{
    questionId: string;
    isCorrect: boolean;
    timeSpentSeconds: number;
    difficulty: "EASY" | "MEDIUM" | "HARD";
    subjectName: string;
    topicName: string;
  }>;
}

export interface SessionAiInsightResult {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  advice: string[];
}

export async function generateSessionInsightsWithAi(
  input: SessionAiInsightInput,
): Promise<SessionAiInsightResult | null> {
  if (!env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Group by topic to find weak spots
  const topicStats: Record<string, { total: number; correct: number; time: number }> = {};
  for (const a of input.answers) {
    if (!topicStats[a.topicName]) {
      topicStats[a.topicName] = { total: 0, correct: 0, time: 0 };
    }
    const stat = topicStats[a.topicName]!;
    stat.total += 1;
    if (a.isCorrect) stat.correct += 1;
    stat.time += a.timeSpentSeconds;
  }

  const prompt = `You are an expert academic tutor analyzing a student's mock exam performance.
  
EXAM DATA:
Title: ${input.examTitle}
Total Questions: ${input.totalQuestions}
Correct Answers: ${input.correctCount}
Total Time Spent: ${Math.floor(input.totalTimeSeconds / 60)} minutes

TOPIC PERFORMANCE:
${Object.entries(topicStats).map(([topic, stats]) => `- ${topic}: ${stats.correct}/${stats.total} correct, time spent: ${Math.floor(stats.time / 60)}m ${stats.time % 60}s`).join("\n")}

PER-QUESTION TIMING & OUTCOMES:
${input.answers.map((a, i) => `Q${i+1} (${a.difficulty}, ${a.topicName}): ${a.isCorrect ? 'Correct' : 'Incorrect'}, time: ${Math.floor(a.timeSpentSeconds / 60)}m ${a.timeSpentSeconds % 60}s`).join("\n")}

INSTRUCTIONS:
Analyze the time spent per question and the correctness. 
Identify patterns (e.g., spending too much time on easy questions, rushing hard questions, strong in certain topics, weak in others).
Provide a concise, encouraging summary, identify key strengths and weaknesses based on BOTH accuracy and time management, and give actionable advice.

Respond strictly with a JSON object (no markdown formatting, no extra text):
{
  "summary": "A 2-3 sentence overview of their performance.",
  "strengths": ["Strength 1", "Strength 2"],
  "weaknesses": ["Weakness 1", "Weakness 2"],
  "advice": ["Actionable tip 1", "Actionable tip 2"]
}
`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("");

    // Strip out markdown code block if Claude includes it
    let cleanText = text.trim();
    if (cleanText.startsWith("```")) {
      const firstNewline = cleanText.indexOf("\n");
      cleanText = cleanText.substring(firstNewline + 1);
      if (cleanText.endsWith("```")) {
        cleanText = cleanText.substring(0, cleanText.length - 3).trim();
      }
    }

    return JSON.parse(cleanText) as SessionAiInsightResult;
  } catch (error) {
    console.error("AI Insight Error:", error);
    return null;
  }
}
