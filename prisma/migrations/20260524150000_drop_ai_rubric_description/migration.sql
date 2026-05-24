-- Drop the optional description column from ai_rubrics.
ALTER TABLE "ai_rubrics" DROP COLUMN IF EXISTS "description";
