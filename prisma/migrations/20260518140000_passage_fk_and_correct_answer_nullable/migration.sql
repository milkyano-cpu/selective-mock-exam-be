-- Passage: replace section/topic strings with FK relations to Subject/Topic.
-- Add imageAltText and imageCaption fields.
ALTER TABLE "passages" DROP COLUMN IF EXISTS "section",
DROP COLUMN IF EXISTS "topic",
ADD COLUMN IF NOT EXISTS "image_alt_text" TEXT,
ADD COLUMN IF NOT EXISTS "image_caption" TEXT,
ADD COLUMN IF NOT EXISTS "subject_id" TEXT,
ADD COLUMN IF NOT EXISTS "topic_id" TEXT;

CREATE INDEX IF NOT EXISTS "passages_subject_id_idx" ON "passages"("subject_id");
CREATE INDEX IF NOT EXISTS "passages_topic_id_idx" ON "passages"("topic_id");

ALTER TABLE "passages" DROP CONSTRAINT IF EXISTS "passages_subject_id_fkey";
ALTER TABLE "passages" ADD CONSTRAINT "passages_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "passages" DROP CONSTRAINT IF EXISTS "passages_topic_id_fkey";
ALTER TABLE "passages" ADD CONSTRAINT "passages_topic_id_fkey"
  FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Question: make correctAnswer nullable (Essay questions don't need it).
ALTER TABLE "questions" ALTER COLUMN "correct_answer" DROP NOT NULL;
