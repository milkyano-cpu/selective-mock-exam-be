-- Rename all tables to snake_case plural format
-- Using RENAME instead of DROP+CREATE to preserve all existing data

ALTER TABLE "User"                   RENAME TO "users";
ALTER TABLE "ParentStudentRelation"  RENAME TO "parent_student_relations";
ALTER TABLE "Subject"                RENAME TO "subjects";
ALTER TABLE "Topic"                  RENAME TO "topics";
ALTER TABLE "Question"               RENAME TO "questions";
ALTER TABLE "Exam"                   RENAME TO "exams";
ALTER TABLE "ExamQuestion"           RENAME TO "exam_questions";
ALTER TABLE "ExamSession"            RENAME TO "exam_sessions";
ALTER TABLE "StudentAnswer"          RENAME TO "student_answers";
ALTER TABLE "PracticeSession"        RENAME TO "practice_sessions";
ALTER TABLE "PracticeAnswer"         RENAME TO "practice_answers";
ALTER TABLE "Recommendation"         RENAME TO "recommendations";
ALTER TABLE "StudentPerformance"     RENAME TO "student_performances";
ALTER TABLE "Leaderboard"            RENAME TO "leaderboards";
ALTER TABLE "Flashcard"              RENAME TO "flashcards";
ALTER TABLE "FlashcardReview"        RENAME TO "flashcard_reviews";
ALTER TABLE "ForumPost"              RENAME TO "forum_posts";
ALTER TABLE "StudyResource"          RENAME TO "study_resources";
ALTER TABLE "SystemSetting"          RENAME TO "system_settings";
ALTER TABLE "Banner"                 RENAME TO "banners";
ALTER TABLE "Subscription"           RENAME TO "subscriptions";
-- refresh_tokens already has the correct name, no rename needed
