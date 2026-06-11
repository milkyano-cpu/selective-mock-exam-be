-- Denormalize the opening post's anonymity onto the thread so the thread list
-- and detail can mask the author correctly (fixes anonymous-author name leak).
ALTER TABLE "forum_threads" ADD COLUMN "is_anonymous" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: a thread is anonymous when its earliest (opening) post was anonymous.
UPDATE "forum_threads" t
SET "is_anonymous" = sub.is_anonymous
FROM (
  SELECT DISTINCT ON (thread_id) thread_id, is_anonymous
  FROM "forum_posts"
  ORDER BY thread_id, created_at ASC
) sub
WHERE sub.thread_id = t.id;
