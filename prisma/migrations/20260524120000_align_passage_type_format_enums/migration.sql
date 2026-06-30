-- Align passages with the final design:
-- passage_format captures the content form, passage_type captures the passage category.

-- Ensure the legacy text column exists so this migration is reproducible on a
-- fresh database. On older DBs it was added out-of-band (db push); on fresh
-- DBs it never existed. It is dropped again further down after the backfill.
ALTER TABLE "passages" ADD COLUMN IF NOT EXISTS "passage_format" TEXT;

CREATE TYPE "PassageFormat" AS ENUM ('text', 'poem', 'article', 'visual_text', 'image_only');
CREATE TYPE "PassageType_new" AS ENUM ('comprehension', 'poem', 'visual');

ALTER TABLE "passages"
ADD COLUMN "passage_format_new" "PassageFormat",
ADD COLUMN "passage_type_new" "PassageType_new";

UPDATE "passages"
SET
  "passage_format_new" = CASE
    WHEN lower(coalesce("passage_format", '')) IN ('text', 'plain') THEN 'text'::"PassageFormat"
    WHEN lower(coalesce("passage_format", '')) = 'poem' THEN 'poem'::"PassageFormat"
    WHEN lower(coalesce("passage_format", '')) = 'article' THEN 'article'::"PassageFormat"
    WHEN lower(coalesce("passage_format", '')) IN ('visual_text', 'visual text', 'visualtext', 'text_image', 'text image', 'text+image') THEN 'visual_text'::"PassageFormat"
    WHEN lower(coalesce("passage_format", '')) IN ('image_only', 'image only', 'imageonly', 'image') THEN 'image_only'::"PassageFormat"
    WHEN "passage_type"::text = 'TEXT' THEN 'text'::"PassageFormat"
    WHEN "passage_type"::text = 'IMAGE' THEN 'image_only'::"PassageFormat"
    WHEN "passage_type"::text = 'TEXT_IMAGE' THEN 'visual_text'::"PassageFormat"
    ELSE NULL
  END,
  "passage_type_new" = CASE
    WHEN lower(coalesce("passage_format", '')) = 'poem' THEN 'poem'::"PassageType_new"
    WHEN lower(coalesce("passage_format", '')) IN ('visual_text', 'visual text', 'visualtext', 'image_only', 'image only', 'imageonly', 'image') THEN 'visual'::"PassageType_new"
    WHEN "passage_type"::text IN ('IMAGE', 'TEXT_IMAGE') THEN 'visual'::"PassageType_new"
    WHEN "passage_type" IS NULL AND "passage_format" IS NULL THEN NULL
    ELSE 'comprehension'::"PassageType_new"
  END;

ALTER TABLE "passages" DROP COLUMN "passage_format";
ALTER TABLE "passages" DROP COLUMN "passage_type";

DROP TYPE "PassageType";
ALTER TYPE "PassageType_new" RENAME TO "PassageType";

ALTER TABLE "passages" RENAME COLUMN "passage_format_new" TO "passage_format";
ALTER TABLE "passages" RENAME COLUMN "passage_type_new" TO "passage_type";
