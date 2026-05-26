import { describe, expect, it } from "@jest/globals";
import Fastify from "fastify";
import { examSchemas } from "../../src/modules/exams/exams.schema.js";

describe("exam response schemas", () => {
  it("serializes AI feedback details in a review session response", async () => {
    const app = Fastify();
    for (const schema of examSchemas) app.addSchema(schema);

    app.get("/review", {
      schema: {
        response: { 200: { $ref: "reviewSessionResponseSchema#" } },
      },
      handler: async () => ({
        success: true,
        message: "Review session retrieved successfully",
        data: {
          sessionId: "session-1",
          examId: "exam-1",
          examTitle: "Writing Assessment",
          gradingType: "AUTO",
          status: "GRADED",
          student: {
            id: "student-1",
            fullName: "Student Name",
            email: "student@example.com",
          },
          finalScore: 75,
          mcqScore: null,
          essayScore: 75,
          rankingLevel: "AVERAGE",
          totalTimeSeconds: 120,
          activeTimeSeconds: 100,
          idleTimeSeconds: 20,
          startTime: "2026-05-25T00:00:00.000Z",
          endTime: "2026-05-25T00:02:00.000Z",
          answers: [{
            answerId: "answer-1",
            questionId: "question-1",
            order: 1,
            type: "ESSAY",
            questionText: "Write an essay.",
            promptText: null,
            latexEnabled: false,
            options: null,
            correctAnswer: "",
            explanation: null,
            studentAnswer: "An answer.",
            timeSpentSeconds: 120,
            maxMarks: 4,
            isCorrect: false,
            awardedMarks: 3,
            manualScore: null,
            tutorFeedback: null,
            reviewStatus: "AI_GRADED",
            aiFeedback: {
              isCorrect: false,
              confidence: "high",
              feedback: null,
              overallFeedback: "Strong response.",
              strengths: ["Clear reasoning"],
              improvements: ["Add more evidence"],
              bandLabel: "Strong",
              bandDescriptor: "Demonstrates clear control.",
              pendingReview: null,
              reason: null,
              gradedAt: "2026-05-25T00:02:00.000Z",
              aiRubric: {
                id: "rubric-1",
                name: "Writing Rubric",
                totalMaxScore: 4,
              },
              criterionScores: [{
                criterionId: "criterion-1",
                criterionName: "Reasoning",
                score: 3,
                maxScore: 4,
                feedback: "Clear but could use support.",
                strengths: ["Clear claim"],
                improvements: ["Use a quotation"],
              }],
              totalAwardedMarks: 3,
              totalPossibleMarks: 4,
              scorePercent: 75,
            },
          }],
        },
      }),
    });

    const response = await app.inject({ method: "GET", url: "/review" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().data.answers[0].isCorrect).toBe(false);
    expect(response.json().data.answers[0].aiFeedback).toMatchObject({
      isCorrect: false,
      overallFeedback: "Strong response.",
      strengths: ["Clear reasoning"],
      improvements: ["Add more evidence"],
      bandLabel: "Strong",
      criterionScores: [{
        strengths: ["Clear claim"],
        improvements: ["Use a quotation"],
      }],
    });
  });
});
