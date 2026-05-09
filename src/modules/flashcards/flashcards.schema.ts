import { z } from "zod";
import { buildJsonSchemas } from "../../utils/build-schemas.js";

const reviewRatingSchema = z.enum(["again", "hard", "good", "easy"]);

const flashcardIdParamSchema = z.object({
  id: z.string().uuid(),
});

const listFlashcardsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  dueOnly: z.coerce.boolean().optional().default(false),
});

const createFlashcardBodySchema = z.object({
  questionId: z.string().uuid().optional(),
  frontContent: z.string().trim().min(1).max(5000),
  backContent: z.string().trim().min(1).max(5000),
});

const updateFlashcardBodySchema = z.object({
  frontContent: z.string().trim().min(1).max(5000).optional(),
  backContent: z.string().trim().min(1).max(5000).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided",
});

const reviewFlashcardBodySchema = z.object({
  rating: reviewRatingSchema,
});

const generateFromMistakesBodySchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(30),
});

const flashcardReviewSchema = z.object({
  easeFactor: z.number(),
  intervalDays: z.number(),
  repetitions: z.number(),
  nextReviewDate: z.string(),
  isDue: z.boolean(),
});

const flashcardItemSchema = z.object({
  id: z.string(),
  questionId: z.string().nullable(),
  frontContent: z.string(),
  backContent: z.string(),
  source: z.enum(["manual", "question"]),
  createdAt: z.string(),
  review: flashcardReviewSchema,
});

const flashcardStatsSchema = z.object({
  total: z.number(),
  due: z.number(),
  newCards: z.number(),
  reviewed: z.number(),
});

const flashcardsListResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(flashcardItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const flashcardResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: flashcardItemSchema,
});

const flashcardsDueResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.array(flashcardItemSchema),
});

const flashcardsStatsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: flashcardStatsSchema,
});

const generateFromMistakesResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    created: z.number(),
    skipped: z.number(),
    cards: z.array(flashcardItemSchema),
  }),
});

const deleteFlashcardResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type ReviewRating = z.infer<typeof reviewRatingSchema>;
export type ListFlashcardsQuery = z.infer<typeof listFlashcardsQuerySchema>;
export type CreateFlashcardBody = z.infer<typeof createFlashcardBodySchema>;
export type UpdateFlashcardBody = z.infer<typeof updateFlashcardBodySchema>;
export type ReviewFlashcardBody = z.infer<typeof reviewFlashcardBodySchema>;
export type GenerateFromMistakesBody = z.infer<typeof generateFromMistakesBodySchema>;

export const { schemas: flashcardSchemas, $ref: flashcardRef } = buildJsonSchemas({
  flashcardIdParamSchema,
  listFlashcardsQuerySchema,
  createFlashcardBodySchema,
  updateFlashcardBodySchema,
  reviewFlashcardBodySchema,
  generateFromMistakesBodySchema,
  flashcardReviewSchema,
  flashcardItemSchema,
  flashcardStatsSchema,
  flashcardsListResponseSchema,
  flashcardResponseSchema,
  flashcardsDueResponseSchema,
  flashcardsStatsResponseSchema,
  generateFromMistakesResponseSchema,
  deleteFlashcardResponseSchema,
});
