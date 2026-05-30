import { describe, expect, it } from "@jest/globals";
import Fastify from "fastify";
import { practiceSchemas } from "../../src/modules/practice/practice.schema.js";

const passage = {
  id: "passage-1",
  title: "A passage",
  text: "Passage text",
  imageRef: null,
  imageDisplayPosition: null,
  image: null,
};

const question = {
  questionId: "question-1",
  order: 1,
  type: "MCQ",
  questionText: "Choose the answer.",
  writingType: null,
  promptText: null,
  latexEnabled: false,
  difficulty: "EASY",
  options: [{ key: "A", text: "Answer A" }],
  imageRefs: [],
  images: [],
  correctAnswer: "A",
  explanation: "Because A.",
  maxMarks: 1,
  passage,
};

describe("practice response schemas", () => {
  it("serializes completed session answers with scoring and passage metadata", async () => {
    const app = Fastify();
    for (const schema of practiceSchemas) app.addSchema(schema);

    app.get("/session", {
      schema: {
        response: { 200: { $ref: "getPracticeSessionResponseSchema#" } },
      },
      handler: async () => ({
        success: true,
        message: "Practice session retrieved",
        data: {
          sessionId: "session-1",
          topicId: "topic-1",
          topicName: "Analogies",
          subjectId: "subject-1",
          subjectName: "Verbal Reasoning",
          sourceType: "SELF_SELECTED",
          pathwayNodeId: null,
          pathwayId: null,
          planId: null,
          difficulty: "EASY",
          questionCount: 1,
          status: "COMPLETED",
          startedAt: "2026-05-26T00:00:00.000Z",
          endedAt: "2026-05-26T00:01:00.000Z",
          totalTimeSeconds: 60,
          questions: [question],
          answers: [
            {
              ...question,
              studentAnswer: "A",
              isCorrect: true,
              timeSpentSeconds: 60,
              awardedMarks: 1,
              bandLabel: null,
              bandDescriptor: null,
              gradingStatus: "GRADED",
              aiFeedback: null,
            },
          ],
        },
      }),
    });

    const response = await app.inject({ method: "GET", url: "/session" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().data.answers[0]).toMatchObject({
      maxMarks: 1,
      passage,
      awardedMarks: 1,
    });
    expect(response.json().data.questions[0].passage).toEqual(passage);
  });
});
