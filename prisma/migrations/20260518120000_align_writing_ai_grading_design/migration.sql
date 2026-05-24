-- Align Writing/AI grading schema with final-design.md.

-- Question fields for Writing essays.
ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "writing_type" TEXT,
  ADD COLUMN IF NOT EXISTS "prompt_text" TEXT,
  ADD COLUMN IF NOT EXISTS "marking_guide" TEXT;

UPDATE "questions"
SET
  "marking_guide" = NULLIF("correct_answer", ''),
  "correct_answer" = ''
WHERE "type" = 'ESSAY'
  AND NULLIF("correct_answer", '') IS NOT NULL
  AND "marking_guide" IS NULL;

-- Final marking enum is AUTO | AI. Preserve legacy AI_RUBRIC/RUBRIC data.
ALTER TABLE "questions" ALTER COLUMN "marking_type" DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuestionMarkingType') THEN
    DROP TYPE IF EXISTS "QuestionMarkingType_new";
    CREATE TYPE "QuestionMarkingType_new" AS ENUM ('AUTO', 'AI');

    ALTER TABLE "questions"
      ALTER COLUMN "marking_type" TYPE "QuestionMarkingType_new"
      USING (
        CASE
          WHEN "marking_type"::text IN ('AI_RUBRIC', 'RUBRIC') THEN 'AI'
          ELSE "marking_type"::text
        END
      )::"QuestionMarkingType_new";

    DROP TYPE "QuestionMarkingType";
    ALTER TYPE "QuestionMarkingType_new" RENAME TO "QuestionMarkingType";
  END IF;
END $$;

ALTER TABLE "questions" ALTER COLUMN "marking_type" SET DEFAULT 'AUTO';

-- Rubric criteria final guidance fields.
ALTER TABLE "ai_rubric_criteria"
  ADD COLUMN IF NOT EXISTS "high_scoring_indicators" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "low_scoring_indicators" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "ai_calibration_notes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Move band descriptors from criterion-level to rubric-level.
ALTER TABLE "ai_rubric_band_descriptors"
  ADD COLUMN IF NOT EXISTS "ai_rubric_id" TEXT,
  ADD COLUMN IF NOT EXISTS "band_label" TEXT;

UPDATE "ai_rubric_band_descriptors" bd
SET
  "ai_rubric_id" = c."ai_rubric_id",
  "band_label" = COALESCE(bd."band_label", bd."score_min"::TEXT || '-' || bd."score_max"::TEXT)
FROM "ai_rubric_criteria" c
WHERE bd."criterion_id" = c."id"
  AND bd."ai_rubric_id" IS NULL;

UPDATE "ai_rubric_band_descriptors"
SET "band_label" = "score_min"::TEXT || '-' || "score_max"::TEXT
WHERE "band_label" IS NULL;

DELETE FROM "ai_rubric_band_descriptors" WHERE "ai_rubric_id" IS NULL;

ALTER TABLE "ai_rubric_band_descriptors"
  ALTER COLUMN "ai_rubric_id" SET NOT NULL,
  ALTER COLUMN "band_label" SET NOT NULL;

ALTER TABLE "ai_rubric_band_descriptors" DROP CONSTRAINT IF EXISTS "rubric_band_descriptors_criterion_id_fkey";
ALTER TABLE "ai_rubric_band_descriptors" DROP CONSTRAINT IF EXISTS "ai_rubric_band_descriptors_criterion_id_fkey";
DROP INDEX IF EXISTS "rubric_band_descriptors_criterion_id_score_min_score_max_idx";
DROP INDEX IF EXISTS "ai_rubric_band_descriptors_criterion_id_score_min_score_max_idx";

ALTER TABLE "ai_rubric_band_descriptors" DROP COLUMN IF EXISTS "criterion_id";

CREATE INDEX IF NOT EXISTS "ai_rubric_band_descriptors_ai_rubric_id_score_min_score_max_idx"
  ON "ai_rubric_band_descriptors"("ai_rubric_id", "score_min", "score_max");

ALTER TABLE "ai_rubric_band_descriptors"
  ADD CONSTRAINT "ai_rubric_band_descriptors_ai_rubric_id_fkey"
  FOREIGN KEY ("ai_rubric_id") REFERENCES "ai_rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ai_calibration_notes" (
  "id" TEXT NOT NULL,
  "ai_rubric_id" TEXT NOT NULL,
  "note_type" TEXT,
  "note" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_calibration_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_calibration_notes_ai_rubric_id_sort_order_idx"
  ON "ai_calibration_notes"("ai_rubric_id", "sort_order");

ALTER TABLE "ai_calibration_notes" DROP CONSTRAINT IF EXISTS "ai_calibration_notes_ai_rubric_id_fkey";
ALTER TABLE "ai_calibration_notes"
  ADD CONSTRAINT "ai_calibration_notes_ai_rubric_id_fkey"
  FOREIGN KEY ("ai_rubric_id") REFERENCES "ai_rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exam attempt tracking.
ALTER TABLE "exam_sessions"
  ADD COLUMN IF NOT EXISTS "is_first_attempt" BOOLEAN NOT NULL DEFAULT false;

UPDATE "exam_sessions"
SET "is_first_attempt" = true
WHERE "attempt_number" = 1;

-- Final answer grading/audit fields.
ALTER TABLE "student_answers"
  ADD COLUMN IF NOT EXISTS "band_label" TEXT,
  ADD COLUMN IF NOT EXISTS "band_descriptor" TEXT,
  ADD COLUMN IF NOT EXISTS "is_overridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "override_score" DECIMAL(7,2),
  ADD COLUMN IF NOT EXISTS "override_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "overridden_by" TEXT,
  ADD COLUMN IF NOT EXISTS "ai_model" TEXT;

ALTER TABLE "student_answers" DROP CONSTRAINT IF EXISTS "student_answers_overridden_by_fkey";
ALTER TABLE "student_answers"
  ADD CONSTRAINT "student_answers_overridden_by_fkey"
  FOREIGN KEY ("overridden_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "essay_answer_scores"
  ADD COLUMN IF NOT EXISTS "strengths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "improvements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "practice_answers"
  ADD COLUMN IF NOT EXISTS "awarded_marks" DECIMAL(7,2),
  ADD COLUMN IF NOT EXISTS "ai_feedback" JSONB,
  ADD COLUMN IF NOT EXISTS "band_label" TEXT,
  ADD COLUMN IF NOT EXISTS "band_descriptor" TEXT,
  ADD COLUMN IF NOT EXISTS "grading_status" TEXT NOT NULL DEFAULT 'GRADED',
  ADD COLUMN IF NOT EXISTS "ai_model" TEXT;

CREATE TABLE IF NOT EXISTS "practice_essay_scores" (
  "id" TEXT NOT NULL,
  "practice_answer_id" TEXT NOT NULL,
  "ai_rubric_id" TEXT,
  "criterion_id" TEXT,
  "criterion_name" TEXT NOT NULL,
  "score" DECIMAL(7,2) NOT NULL,
  "max_score" DECIMAL(7,2) NOT NULL,
  "feedback" TEXT,
  "strengths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "improvements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "practice_essay_scores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "practice_essay_scores_practice_answer_id_idx" ON "practice_essay_scores"("practice_answer_id");
CREATE INDEX IF NOT EXISTS "practice_essay_scores_ai_rubric_id_idx" ON "practice_essay_scores"("ai_rubric_id");
CREATE INDEX IF NOT EXISTS "practice_essay_scores_criterion_id_idx" ON "practice_essay_scores"("criterion_id");

ALTER TABLE "practice_essay_scores" DROP CONSTRAINT IF EXISTS "practice_essay_scores_practice_answer_id_fkey";
ALTER TABLE "practice_essay_scores" DROP CONSTRAINT IF EXISTS "practice_essay_scores_ai_rubric_id_fkey";
ALTER TABLE "practice_essay_scores" DROP CONSTRAINT IF EXISTS "practice_essay_scores_criterion_id_fkey";

ALTER TABLE "practice_essay_scores"
  ADD CONSTRAINT "practice_essay_scores_practice_answer_id_fkey"
  FOREIGN KEY ("practice_answer_id") REFERENCES "practice_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "practice_essay_scores_ai_rubric_id_fkey"
  FOREIGN KEY ("ai_rubric_id") REFERENCES "ai_rubrics"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "practice_essay_scores_criterion_id_fkey"
  FOREIGN KEY ("criterion_id") REFERENCES "ai_rubric_criteria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "exam_attempt_summaries" (
  "id" TEXT NOT NULL,
  "exam_id" TEXT NOT NULL,
  "student_id" TEXT NOT NULL,
  "total_attempts" INTEGER NOT NULL DEFAULT 0,
  "first_session_id" TEXT,
  "latest_session_id" TEXT,
  "best_session_id" TEXT,
  "first_score" DECIMAL(5,2),
  "latest_score" DECIMAL(5,2),
  "best_score" DECIMAL(5,2),
  "incorrect_question_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "subject_breakdown" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exam_attempt_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exam_attempt_summaries_exam_id_student_id_key"
  ON "exam_attempt_summaries"("exam_id", "student_id");
CREATE INDEX IF NOT EXISTS "exam_attempt_summaries_student_id_idx" ON "exam_attempt_summaries"("student_id");
CREATE INDEX IF NOT EXISTS "exam_attempt_summaries_exam_id_idx" ON "exam_attempt_summaries"("exam_id");

ALTER TABLE "exam_attempt_summaries" DROP CONSTRAINT IF EXISTS "exam_attempt_summaries_exam_id_fkey";
ALTER TABLE "exam_attempt_summaries" DROP CONSTRAINT IF EXISTS "exam_attempt_summaries_student_id_fkey";
ALTER TABLE "exam_attempt_summaries" DROP CONSTRAINT IF EXISTS "exam_attempt_summaries_latest_session_id_fkey";
ALTER TABLE "exam_attempt_summaries" DROP CONSTRAINT IF EXISTS "exam_attempt_summaries_best_session_id_fkey";

ALTER TABLE "exam_attempt_summaries"
  ADD CONSTRAINT "exam_attempt_summaries_exam_id_fkey"
  FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "exam_attempt_summaries_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "exam_attempt_summaries_latest_session_id_fkey"
  FOREIGN KEY ("latest_session_id") REFERENCES "exam_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "exam_attempt_summaries_best_session_id_fkey"
  FOREIGN KEY ("best_session_id") REFERENCES "exam_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
