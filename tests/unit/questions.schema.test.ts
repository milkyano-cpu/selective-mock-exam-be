import { describe, expect, it } from "@jest/globals";
import Fastify from "fastify";
import { questionSchemas } from "../../src/modules/questions/questions.schema.js";

const createBody = {
  subjectId: "11111111-1111-4111-8111-111111111111",
  topicId: "22222222-2222-4222-8222-222222222222",
  type: "MCQ",
  difficulty: "EASY",
  questionText: "Which answer is correct?",
  options: [
    { key: "A", text: "A" },
    { key: "B", text: "B" },
    { key: "C", text: "C" },
    { key: "D", text: "D" },
    { key: "E", text: "E" },
  ],
  correctAnswer: "A",
};

describe("question request schemas", () => {
  it("accepts an optional time limit when cleared or represented as zero", async () => {
    const app = Fastify();
    for (const schema of questionSchemas) app.addSchema(schema);

    app.post("/questions", {
      schema: { body: { $ref: "createQuestionBodySchema#" } },
      handler: async () => ({ ok: true }),
    });
    app.put("/questions/question-1", {
      schema: { body: { $ref: "updateQuestionBodySchema#" } },
      handler: async () => ({ ok: true }),
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/questions",
      payload: { ...createBody, timeLimitSeconds: 0 },
    });
    const updateResponse = await app.inject({
      method: "PUT",
      url: "/questions/question-1",
      payload: { timeLimitSeconds: null },
    });

    await app.close();

    expect(createResponse.statusCode).toBe(200);
    expect(updateResponse.statusCode).toBe(200);
  });
});
