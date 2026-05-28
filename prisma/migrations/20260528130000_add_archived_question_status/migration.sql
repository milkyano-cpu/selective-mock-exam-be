-- Add ARCHIVED to the QuestionStatus enum so admins can retire published
-- questions that have already been used in exams.
ALTER TYPE "QuestionStatus" ADD VALUE 'ARCHIVED';
