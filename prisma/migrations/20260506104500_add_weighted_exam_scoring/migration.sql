ALTER TABLE "student_answers" ADD COLUMN "awarded_marks" DECIMAL(7,2);

CREATE TABLE "essay_answer_scores" (
  "id" TEXT NOT NULL,
  "student_answer_id" TEXT NOT NULL,
  "rubric_id" TEXT,
  "criterion_id" TEXT,
  "criterion_name" TEXT NOT NULL,
  "score" DECIMAL(7,2) NOT NULL,
  "max_score" DECIMAL(7,2) NOT NULL,
  "feedback" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "essay_answer_scores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "essay_answer_scores_student_answer_id_idx" ON "essay_answer_scores"("student_answer_id");
CREATE INDEX "essay_answer_scores_rubric_id_idx" ON "essay_answer_scores"("rubric_id");
CREATE INDEX "essay_answer_scores_criterion_id_idx" ON "essay_answer_scores"("criterion_id");

ALTER TABLE "essay_answer_scores" ADD CONSTRAINT "essay_answer_scores_student_answer_id_fkey" FOREIGN KEY ("student_answer_id") REFERENCES "student_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "essay_answer_scores" ADD CONSTRAINT "essay_answer_scores_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "rubrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "essay_answer_scores" ADD CONSTRAINT "essay_answer_scores_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "rubric_criteria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
