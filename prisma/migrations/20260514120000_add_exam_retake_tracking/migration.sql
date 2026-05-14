-- CreateEnum
CREATE TYPE "RetakeMode" AS ENUM ('FULL', 'INCORRECT_ONLY', 'SUBJECT_ONLY');

-- AlterTable
ALTER TABLE "exam_sessions" ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "exam_sessions" ADD COLUMN "retake_mode" "RetakeMode";
ALTER TABLE "exam_sessions" ADD COLUMN "parent_session_id" TEXT;
ALTER TABLE "exam_sessions" ADD COLUMN "retake_question_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_parent_session_id_fkey" FOREIGN KEY ("parent_session_id") REFERENCES "exam_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
