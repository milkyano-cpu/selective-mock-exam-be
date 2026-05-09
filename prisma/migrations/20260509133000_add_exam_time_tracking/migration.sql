ALTER TABLE "exam_sessions"
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "active_time_seconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "idle_time_seconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_activity_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_heartbeat_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "active_question_id" TEXT;

UPDATE "exam_sessions" AS session
SET "expires_at" = session."start_time" + (exam."duration_minutes" * INTERVAL '1 minute')
FROM "exams" AS exam
WHERE session."exam_id" = exam."id"
  AND session."expires_at" IS NULL
  AND exam."duration_minutes" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "exam_sessions_expires_at_idx"
  ON "exam_sessions"("expires_at");

CREATE INDEX IF NOT EXISTS "exam_sessions_last_heartbeat_at_idx"
  ON "exam_sessions"("last_heartbeat_at");
