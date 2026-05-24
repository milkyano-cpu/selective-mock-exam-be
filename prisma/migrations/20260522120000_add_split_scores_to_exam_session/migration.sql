-- Split scores per question type, in addition to combined final_score
ALTER TABLE "exam_sessions" ADD COLUMN "mcq_score" DECIMAL(5,2);
ALTER TABLE "exam_sessions" ADD COLUMN "essay_score" DECIMAL(5,2);
