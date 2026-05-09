DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'forum_posts' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE "forum_posts" ALTER COLUMN "updated_at" DROP DEFAULT;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'forum_threads' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE "forum_threads" ALTER COLUMN "updated_at" DROP DEFAULT;
  END IF;
END $$;
