CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ForumSegment') THEN
    CREATE TYPE "ForumSegment" AS ENUM ('STUDENT', 'PARENT');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ForumStatus') THEN
    CREATE TYPE "ForumStatus" AS ENUM ('ACTIVE', 'UNDER_REVIEW', 'REJECTED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FlagReason') THEN
    CREATE TYPE "FlagReason" AS ENUM ('INAPPROPRIATE', 'SPAM', 'OFF_TOPIC', 'MISINFORMATION', 'OTHER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FlagStatus') THEN
    CREATE TYPE "FlagStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WarningLevel') THEN
    CREATE TYPE "WarningLevel" AS ENUM ('WARNING', 'SUSPEND');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "forum_threads" (
  "id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "segment" "ForumSegment" NOT NULL,
  "title" TEXT NOT NULL,
  "is_pinned" BOOLEAN NOT NULL DEFAULT false,
  "is_locked" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forum_threads_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'forum_posts'
  ) THEN
    CREATE TABLE "forum_posts" (
      "id" TEXT NOT NULL,
      "thread_id" TEXT NOT NULL,
      "author_id" TEXT NOT NULL,
      "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
      "content" TEXT NOT NULL,
      "status" "ForumStatus" NOT NULL DEFAULT 'ACTIVE',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

ALTER TABLE "forum_posts" ADD COLUMN IF NOT EXISTS "thread_id" TEXT;
ALTER TABLE "forum_posts" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "forum_posts" ADD COLUMN IF NOT EXISTS "is_anonymous" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "forum_posts" ADD COLUMN IF NOT EXISTS "status" "ForumStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "forum_posts" ADD COLUMN IF NOT EXISTS "target_audience" "Role";

DO $$
BEGIN
  ALTER TABLE "forum_posts" ALTER COLUMN "target_audience" DROP NOT NULL;
END $$;

CREATE TEMP TABLE IF NOT EXISTS "legacy_forum_thread_map" (
  "post_id" TEXT PRIMARY KEY,
  "thread_id" TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO "legacy_forum_thread_map" ("post_id", "thread_id")
SELECT "id", gen_random_uuid()::text
FROM "forum_posts"
WHERE "thread_id" IS NULL
ON CONFLICT ("post_id") DO NOTHING;

INSERT INTO "forum_threads" (
  "id",
  "author_id",
  "segment",
  "title",
  "is_pinned",
  "is_locked",
  "created_at",
  "updated_at"
)
SELECT
  m."thread_id",
  p."author_id",
  CASE WHEN p."target_audience"::text = 'PARENT'
    THEN 'PARENT'::"ForumSegment"
    ELSE 'STUDENT'::"ForumSegment"
  END,
  COALESCE(LEFT(NULLIF(TRIM(p."content"), ''), 120), 'Forum thread'),
  false,
  false,
  p."created_at",
  COALESCE(p."updated_at", p."created_at")
FROM "forum_posts" p
JOIN "legacy_forum_thread_map" m ON m."post_id" = p."id";

UPDATE "forum_posts" p
SET "thread_id" = m."thread_id"
FROM "legacy_forum_thread_map" m
WHERE p."id" = m."post_id";

ALTER TABLE "forum_posts" DROP COLUMN IF EXISTS "target_audience";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "forum_posts" WHERE "thread_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot set forum_posts.thread_id NOT NULL while null rows remain';
  END IF;
END $$;

ALTER TABLE "forum_posts" ALTER COLUMN "thread_id" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "forum_flags" (
  "id" TEXT NOT NULL,
  "post_id" TEXT NOT NULL,
  "reporter_id" TEXT NOT NULL,
  "reason" "FlagReason" NOT NULL,
  "note" TEXT,
  "status" "FlagStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forum_flags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "forum_warnings" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "admin_id" TEXT NOT NULL,
  "level" "WarningLevel" NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forum_warnings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "forum_banned_words" (
  "id" TEXT NOT NULL,
  "word" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "forum_banned_words_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "forum_flags_post_id_reporter_id_key" ON "forum_flags"("post_id", "reporter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "forum_banned_words_word_key" ON "forum_banned_words"("word");
CREATE INDEX IF NOT EXISTS "forum_threads_segment_created_at_idx" ON "forum_threads"("segment", "created_at");
CREATE INDEX IF NOT EXISTS "forum_threads_is_pinned_segment_idx" ON "forum_threads"("is_pinned", "segment");
CREATE INDEX IF NOT EXISTS "forum_posts_thread_id_status_created_at_idx" ON "forum_posts"("thread_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "forum_posts_author_id_idx" ON "forum_posts"("author_id");
CREATE INDEX IF NOT EXISTS "forum_flags_status_created_at_idx" ON "forum_flags"("status", "created_at");
CREATE INDEX IF NOT EXISTS "forum_warnings_user_id_created_at_idx" ON "forum_warnings"("user_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_threads_author_id_fkey') THEN
    ALTER TABLE "forum_threads"
    ADD CONSTRAINT "forum_threads_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_posts_thread_id_fkey') THEN
    ALTER TABLE "forum_posts"
    ADD CONSTRAINT "forum_posts_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "forum_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_posts_author_id_fkey') THEN
    ALTER TABLE "forum_posts"
    ADD CONSTRAINT "forum_posts_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_flags_post_id_fkey') THEN
    ALTER TABLE "forum_flags"
    ADD CONSTRAINT "forum_flags_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_flags_reporter_id_fkey') THEN
    ALTER TABLE "forum_flags"
    ADD CONSTRAINT "forum_flags_reporter_id_fkey"
    FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_flags_reviewed_by_fkey') THEN
    ALTER TABLE "forum_flags"
    ADD CONSTRAINT "forum_flags_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_warnings_user_id_fkey') THEN
    ALTER TABLE "forum_warnings"
    ADD CONSTRAINT "forum_warnings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forum_warnings_admin_id_fkey') THEN
    ALTER TABLE "forum_warnings"
    ADD CONSTRAINT "forum_warnings_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
