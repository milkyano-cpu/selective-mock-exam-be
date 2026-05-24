-- Align Passage storage with the final design contract.

ALTER TABLE "passages" RENAME COLUMN "content" TO "text";
ALTER TABLE "passages" DROP COLUMN IF EXISTS "image_url";

WITH max_existing AS (
  SELECT COALESCE(MAX(substring("external_id" from '^RC([0-9]+)$')::int), 0) AS max_num
  FROM "passages"
  WHERE "external_id" ~ '^RC[0-9]+$'
),
missing AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS row_num
  FROM "passages"
  WHERE "external_id" IS NULL OR btrim("external_id") = ''
)
UPDATE "passages" AS p
SET "external_id" = 'RC' || lpad((max_existing.max_num + missing.row_num)::text, 3, '0')
FROM missing, max_existing
WHERE p."id" = missing."id";

UPDATE "passages"
SET "passage_format" = CASE
  WHEN "image_ref" IS NOT NULL AND "text" IS NOT NULL THEN 'visual_text'::"PassageFormat"
  WHEN "image_ref" IS NOT NULL THEN 'image_only'::"PassageFormat"
  ELSE 'text'::"PassageFormat"
END
WHERE "passage_format" IS NULL;

UPDATE "passages"
SET "passage_type" = CASE
  WHEN "passage_format" = 'poem' THEN 'poem'::"PassageType"
  WHEN "passage_format" IN ('visual_text', 'image_only') THEN 'visual'::"PassageType"
  ELSE 'comprehension'::"PassageType"
END
WHERE "passage_type" IS NULL;

UPDATE "passages"
SET "difficulty" = upper("difficulty")
WHERE "difficulty" IS NOT NULL;

UPDATE "passages"
SET "difficulty" = 'MEDIUM'
WHERE "difficulty" IS NULL OR "difficulty" NOT IN ('EASY', 'MEDIUM', 'HARD');

WITH reading_subject AS (
  SELECT "id"
  FROM "subjects"
  WHERE lower("name") = 'reading comprehension'
     OR lower("name") LIKE '%reading%'
  ORDER BY CASE WHEN lower("name") = 'reading comprehension' THEN 0 ELSE 1 END, "name"
  LIMIT 1
)
UPDATE "passages"
SET "subject_id" = (SELECT "id" FROM reading_subject)
WHERE "subject_id" IS NULL
  AND EXISTS (SELECT 1 FROM reading_subject);

WITH fallback_topics AS (
  SELECT s."id" AS subject_id, t."id" AS topic_id
  FROM "subjects" s
  JOIN LATERAL (
    SELECT "id"
    FROM "topics"
    WHERE "subject_id" = s."id"
    ORDER BY "name", "id"
    LIMIT 1
  ) t ON true
)
UPDATE "passages" p
SET "topic_id" = ft.topic_id
FROM fallback_topics ft
WHERE p."topic_id" IS NULL
  AND p."subject_id" = ft.subject_id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImageDisplayPosition_new') THEN
    CREATE TYPE "ImageDisplayPosition_new" AS ENUM ('above', 'below', 'inline');
  END IF;
END $$;

ALTER TABLE "passages"
ADD COLUMN "image_display_position_new" "ImageDisplayPosition_new";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'passages'
      AND column_name = 'image_display_position'
  ) THEN
    EXECUTE 'UPDATE "passages"
      SET "image_display_position_new" = CASE
        WHEN "image_display_position"::text = ''ABOVE'' THEN ''above''::"ImageDisplayPosition_new"
        WHEN "image_display_position"::text = ''BELOW'' THEN ''below''::"ImageDisplayPosition_new"
        WHEN "image_display_position" IS NOT NULL THEN ''inline''::"ImageDisplayPosition_new"
        ELSE NULL
      END';
    EXECUTE 'ALTER TABLE "passages" DROP COLUMN "image_display_position"';
  END IF;
END $$;

DROP TYPE IF EXISTS "ImageDisplayPosition";
ALTER TYPE "ImageDisplayPosition_new" RENAME TO "ImageDisplayPosition";
ALTER TABLE "passages" RENAME COLUMN "image_display_position_new" TO "image_display_position";

ALTER TABLE "passages" ALTER COLUMN "external_id" SET NOT NULL;
ALTER TABLE "passages" ALTER COLUMN "passage_format" SET NOT NULL;
ALTER TABLE "passages" ALTER COLUMN "passage_type" SET NOT NULL;
ALTER TABLE "passages" ALTER COLUMN "difficulty" TYPE "Difficulty" USING "difficulty"::"Difficulty";
ALTER TABLE "passages" ALTER COLUMN "difficulty" SET NOT NULL;
ALTER TABLE "passages" ALTER COLUMN "subject_id" SET NOT NULL;
ALTER TABLE "passages" ALTER COLUMN "topic_id" SET NOT NULL;

ALTER TABLE "passages" DROP CONSTRAINT IF EXISTS "passages_subject_id_fkey";
ALTER TABLE "passages" ADD CONSTRAINT "passages_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "passages" DROP CONSTRAINT IF EXISTS "passages_topic_id_fkey";
ALTER TABLE "passages" ADD CONSTRAINT "passages_topic_id_fkey"
  FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
