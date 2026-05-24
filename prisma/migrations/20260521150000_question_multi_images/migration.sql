-- 1. Add new image_refs array column (default empty)
ALTER TABLE "questions" ADD COLUMN "image_refs" TEXT[] NOT NULL DEFAULT '{}';

-- 2. Backfill: copy existing image_urls (already array) into image_refs.
-- If image_urls is empty but image_ref is set, fall back to ARRAY[image_ref].
UPDATE "questions"
SET "image_refs" = CASE
  WHEN array_length("image_urls", 1) > 0 THEN "image_urls"
  WHEN "image_ref" IS NOT NULL THEN ARRAY["image_ref"]
  ELSE ARRAY[]::TEXT[]
END;

-- 3. Drop old FK to images.file_name
ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "questions_image_ref_fkey";

-- 4. Drop old index on image_ref
DROP INDEX IF EXISTS "questions_image_ref_idx";

-- 5. Drop legacy columns
ALTER TABLE "questions" DROP COLUMN "image_ref";
ALTER TABLE "questions" DROP COLUMN "image_url";
ALTER TABLE "questions" DROP COLUMN "image_urls";
