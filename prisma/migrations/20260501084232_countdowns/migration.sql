CREATE TABLE IF NOT EXISTS "exam_countdowns" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "target_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_countdowns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "exam_countdowns_is_active_target_at_idx" ON "exam_countdowns"("is_active", "target_at");
CREATE INDEX IF NOT EXISTS "exam_countdowns_target_at_idx" ON "exam_countdowns"("target_at");
