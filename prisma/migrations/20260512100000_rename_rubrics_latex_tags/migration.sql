DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'is_latex_format'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'latex_enabled'
  ) THEN
    ALTER TABLE "questions" RENAME COLUMN "is_latex_format" TO "latex_enabled";
  END IF;
END $$;

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "adaptive_tags" TEXT,
  ADD COLUMN IF NOT EXISTS "skill_tags" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'rubric_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'ai_rubric_id'
  ) THEN
    ALTER TABLE "questions" RENAME COLUMN "rubric_id" TO "ai_rubric_id";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rubric_criteria' AND column_name = 'rubric_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rubric_criteria' AND column_name = 'ai_rubric_id'
  ) THEN
    ALTER TABLE "rubric_criteria" RENAME COLUMN "rubric_id" TO "ai_rubric_id";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'essay_answer_scores' AND column_name = 'rubric_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'essay_answer_scores' AND column_name = 'ai_rubric_id'
  ) THEN
    ALTER TABLE "essay_answer_scores" RENAME COLUMN "rubric_id" TO "ai_rubric_id";
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.rubrics') IS NOT NULL AND to_regclass('public.ai_rubrics') IS NULL THEN
    ALTER TABLE "rubrics" RENAME TO "ai_rubrics";
  END IF;

  IF to_regclass('public.rubric_criteria') IS NOT NULL AND to_regclass('public.ai_rubric_criteria') IS NULL THEN
    ALTER TABLE "rubric_criteria" RENAME TO "ai_rubric_criteria";
  END IF;

  IF to_regclass('public.rubric_band_descriptors') IS NOT NULL AND to_regclass('public.ai_rubric_band_descriptors') IS NULL THEN
    ALTER TABLE "rubric_band_descriptors" RENAME TO "ai_rubric_band_descriptors";
  END IF;
END $$;

ALTER TABLE "questions" ALTER COLUMN "marking_type" DROP DEFAULT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuestionMarkingType')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'QuestionMarkingType' AND e.enumlabel = 'AI_RUBRIC'
    )
  THEN
    DROP TYPE IF EXISTS "QuestionMarkingType_new";
    CREATE TYPE "QuestionMarkingType_new" AS ENUM ('AUTO', 'AI_RUBRIC');
    ALTER TABLE "questions"
      ALTER COLUMN "marking_type" TYPE "QuestionMarkingType_new"
      USING (
        CASE
          WHEN "marking_type"::text = 'RUBRIC' THEN 'AI_RUBRIC'
          ELSE "marking_type"::text
        END
      )::"QuestionMarkingType_new";
    DROP TYPE "QuestionMarkingType";
    ALTER TYPE "QuestionMarkingType_new" RENAME TO "QuestionMarkingType";
  END IF;
END $$;

ALTER TABLE "questions" ALTER COLUMN "marking_type" SET DEFAULT 'AUTO';

-- Rename content_text → question_text
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'content_text'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'question_text'
  ) THEN
    ALTER TABLE "questions" RENAME COLUMN "content_text" TO "question_text";
  END IF;
END $$;

-- Drop content_latex column
ALTER TABLE "questions" DROP COLUMN IF EXISTS "content_latex";
