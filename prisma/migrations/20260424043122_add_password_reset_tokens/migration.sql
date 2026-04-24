-- AlterTable
ALTER TABLE "banners" RENAME CONSTRAINT "Banner_pkey" TO "banners_pkey";

-- AlterTable
ALTER TABLE "exam_questions" RENAME CONSTRAINT "ExamQuestion_pkey" TO "exam_questions_pkey";

-- AlterTable
ALTER TABLE "exam_sessions" RENAME CONSTRAINT "ExamSession_pkey" TO "exam_sessions_pkey";

-- AlterTable
ALTER TABLE "exams" RENAME CONSTRAINT "Exam_pkey" TO "exams_pkey";

-- AlterTable
ALTER TABLE "flashcard_reviews" RENAME CONSTRAINT "FlashcardReview_pkey" TO "flashcard_reviews_pkey";

-- AlterTable
ALTER TABLE "flashcards" RENAME CONSTRAINT "Flashcard_pkey" TO "flashcards_pkey";

-- AlterTable
ALTER TABLE "forum_posts" RENAME CONSTRAINT "ForumPost_pkey" TO "forum_posts_pkey";

-- AlterTable
ALTER TABLE "leaderboards" RENAME CONSTRAINT "Leaderboard_pkey" TO "leaderboards_pkey";

-- AlterTable
ALTER TABLE "parent_student_relations" RENAME CONSTRAINT "ParentStudentRelation_pkey" TO "parent_student_relations_pkey";

-- AlterTable
ALTER TABLE "practice_answers" RENAME CONSTRAINT "PracticeAnswer_pkey" TO "practice_answers_pkey";

-- AlterTable
ALTER TABLE "practice_sessions" RENAME CONSTRAINT "PracticeSession_pkey" TO "practice_sessions_pkey";

-- AlterTable
ALTER TABLE "questions" RENAME CONSTRAINT "Question_pkey" TO "questions_pkey";

-- AlterTable
ALTER TABLE "recommendations" RENAME CONSTRAINT "Recommendation_pkey" TO "recommendations_pkey";

-- AlterTable
ALTER TABLE "student_answers" RENAME CONSTRAINT "StudentAnswer_pkey" TO "student_answers_pkey";

-- AlterTable
ALTER TABLE "student_performances" RENAME CONSTRAINT "StudentPerformance_pkey" TO "student_performances_pkey";

-- AlterTable
ALTER TABLE "study_resources" RENAME CONSTRAINT "StudyResource_pkey" TO "study_resources_pkey";

-- AlterTable
ALTER TABLE "subjects" RENAME CONSTRAINT "Subject_pkey" TO "subjects_pkey";

-- AlterTable
ALTER TABLE "subscriptions" RENAME CONSTRAINT "Subscription_pkey" TO "subscriptions_pkey";

-- AlterTable
ALTER TABLE "system_settings" RENAME CONSTRAINT "SystemSetting_pkey" TO "system_settings_pkey";

-- AlterTable
ALTER TABLE "topics" RENAME CONSTRAINT "Topic_pkey" TO "topics_pkey";

-- AlterTable
ALTER TABLE "users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- RenameForeignKey
ALTER TABLE "exam_questions" RENAME CONSTRAINT "ExamQuestion_examId_fkey" TO "exam_questions_exam_id_fkey";

-- RenameForeignKey
ALTER TABLE "exam_questions" RENAME CONSTRAINT "ExamQuestion_questionId_fkey" TO "exam_questions_question_id_fkey";

-- RenameForeignKey
ALTER TABLE "exam_sessions" RENAME CONSTRAINT "ExamSession_examId_fkey" TO "exam_sessions_exam_id_fkey";

-- RenameForeignKey
ALTER TABLE "exam_sessions" RENAME CONSTRAINT "ExamSession_studentId_fkey" TO "exam_sessions_student_id_fkey";

-- RenameForeignKey
ALTER TABLE "exams" RENAME CONSTRAINT "Exam_createdBy_fkey" TO "exams_created_by_fkey";

-- RenameForeignKey
ALTER TABLE "flashcard_reviews" RENAME CONSTRAINT "FlashcardReview_flashcardId_fkey" TO "flashcard_reviews_flashcard_id_fkey";

-- RenameForeignKey
ALTER TABLE "flashcards" RENAME CONSTRAINT "Flashcard_questionId_fkey" TO "flashcards_question_id_fkey";

-- RenameForeignKey
ALTER TABLE "flashcards" RENAME CONSTRAINT "Flashcard_studentId_fkey" TO "flashcards_student_id_fkey";

-- RenameForeignKey
ALTER TABLE "forum_posts" RENAME CONSTRAINT "ForumPost_authorId_fkey" TO "forum_posts_author_id_fkey";

-- RenameForeignKey
ALTER TABLE "leaderboards" RENAME CONSTRAINT "Leaderboard_studentId_fkey" TO "leaderboards_student_id_fkey";

-- RenameForeignKey
ALTER TABLE "parent_student_relations" RENAME CONSTRAINT "ParentStudentRelation_parentId_fkey" TO "parent_student_relations_parent_id_fkey";

-- RenameForeignKey
ALTER TABLE "parent_student_relations" RENAME CONSTRAINT "ParentStudentRelation_studentId_fkey" TO "parent_student_relations_student_id_fkey";

-- RenameForeignKey
ALTER TABLE "practice_answers" RENAME CONSTRAINT "PracticeAnswer_questionId_fkey" TO "practice_answers_question_id_fkey";

-- RenameForeignKey
ALTER TABLE "practice_answers" RENAME CONSTRAINT "PracticeAnswer_sessionId_fkey" TO "practice_answers_session_id_fkey";

-- RenameForeignKey
ALTER TABLE "practice_sessions" RENAME CONSTRAINT "PracticeSession_assignedBy_fkey" TO "practice_sessions_assigned_by_fkey";

-- RenameForeignKey
ALTER TABLE "practice_sessions" RENAME CONSTRAINT "PracticeSession_studentId_fkey" TO "practice_sessions_student_id_fkey";

-- RenameForeignKey
ALTER TABLE "practice_sessions" RENAME CONSTRAINT "PracticeSession_topicId_fkey" TO "practice_sessions_topic_id_fkey";

-- RenameForeignKey
ALTER TABLE "questions" RENAME CONSTRAINT "Question_subjectId_fkey" TO "questions_subject_id_fkey";

-- RenameForeignKey
ALTER TABLE "questions" RENAME CONSTRAINT "Question_topicId_fkey" TO "questions_topic_id_fkey";

-- RenameForeignKey
ALTER TABLE "questions" RENAME CONSTRAINT "Question_tutorId_fkey" TO "questions_tutor_id_fkey";

-- RenameForeignKey
ALTER TABLE "recommendations" RENAME CONSTRAINT "Recommendation_studentId_fkey" TO "recommendations_student_id_fkey";

-- RenameForeignKey
ALTER TABLE "recommendations" RENAME CONSTRAINT "Recommendation_topicId_fkey" TO "recommendations_topic_id_fkey";

-- RenameForeignKey
ALTER TABLE "refresh_tokens" RENAME CONSTRAINT "refresh_tokens_userId_fkey" TO "refresh_tokens_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "student_answers" RENAME CONSTRAINT "StudentAnswer_questionId_fkey" TO "student_answers_question_id_fkey";

-- RenameForeignKey
ALTER TABLE "student_answers" RENAME CONSTRAINT "StudentAnswer_sessionId_fkey" TO "student_answers_session_id_fkey";

-- RenameForeignKey
ALTER TABLE "student_performances" RENAME CONSTRAINT "StudentPerformance_studentId_fkey" TO "student_performances_student_id_fkey";

-- RenameForeignKey
ALTER TABLE "student_performances" RENAME CONSTRAINT "StudentPerformance_subjectId_fkey" TO "student_performances_subject_id_fkey";

-- RenameForeignKey
ALTER TABLE "student_performances" RENAME CONSTRAINT "StudentPerformance_topicId_fkey" TO "student_performances_topic_id_fkey";

-- RenameForeignKey
ALTER TABLE "study_resources" RENAME CONSTRAINT "StudyResource_topicId_fkey" TO "study_resources_topic_id_fkey";

-- RenameForeignKey
ALTER TABLE "subscriptions" RENAME CONSTRAINT "Subscription_userId_fkey" TO "subscriptions_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "topics" RENAME CONSTRAINT "Topic_subjectId_fkey" TO "topics_subject_id_fkey";

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "refresh_tokens_tokenHash_key" RENAME TO "refresh_tokens_token_hash_key";

-- RenameIndex
ALTER INDEX "refresh_tokens_userId_idx" RENAME TO "refresh_tokens_user_id_idx";

-- RenameIndex
ALTER INDEX "StudentPerformance_studentId_topicId_key" RENAME TO "student_performances_student_id_topic_id_key";

-- RenameIndex
ALTER INDEX "User_email_key" RENAME TO "users_email_key";
