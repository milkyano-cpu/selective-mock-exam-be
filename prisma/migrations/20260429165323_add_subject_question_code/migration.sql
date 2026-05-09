/*
  Warnings:

  - A unique constraint covering the columns `[question_code]` on the table `subjects` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "question_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "subjects_question_code_key" ON "subjects"("question_code");
