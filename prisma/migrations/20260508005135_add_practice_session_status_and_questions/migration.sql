-- CreateEnum
CREATE TYPE "PracticeSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "practice_sessions" ADD COLUMN     "difficulty" "Difficulty",
ADD COLUMN     "question_count" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "status" "PracticeSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS';

-- CreateTable
CREATE TABLE "practice_session_questions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "practice_session_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_session_questions_session_id_order_idx" ON "practice_session_questions"("session_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "practice_session_questions_session_id_question_id_key" ON "practice_session_questions"("session_id", "question_id");

-- CreateIndex
CREATE INDEX "practice_sessions_student_id_status_idx" ON "practice_sessions"("student_id", "status");

-- AddForeignKey
ALTER TABLE "practice_session_questions" ADD CONSTRAINT "practice_session_questions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "practice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_session_questions" ADD CONSTRAINT "practice_session_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
