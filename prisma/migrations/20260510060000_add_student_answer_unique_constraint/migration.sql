-- Add unique constraint on (session_id, question_id) for StudentAnswer
-- This enables proper upsert behavior and prevents duplicate answers

-- First, deduplicate any existing rows (keep the latest by id)
DELETE FROM "student_answers" a
USING "student_answers" b
WHERE a."session_id" = b."session_id"
  AND a."question_id" = b."question_id"
  AND a."id" < b."id";

-- Drop the existing non-unique index (will be replaced by unique constraint)
DROP INDEX IF EXISTS "student_answers_session_id_question_id_idx";

-- Add the unique constraint
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_session_id_question_id_key" UNIQUE ("session_id", "question_id");
