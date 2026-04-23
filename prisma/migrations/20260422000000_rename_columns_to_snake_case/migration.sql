-- Rename camelCase columns to snake_case across all tables
-- Uses ALTER TABLE ... RENAME COLUMN to preserve all existing data

-- users
ALTER TABLE users RENAME COLUMN "passwordHash" TO password_hash;
ALTER TABLE users RENAME COLUMN "fullName" TO full_name;
ALTER TABLE users RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE users RENAME COLUMN "updatedAt" TO updated_at;

-- parent_student_relations
ALTER TABLE parent_student_relations RENAME COLUMN "parentId" TO parent_id;
ALTER TABLE parent_student_relations RENAME COLUMN "studentId" TO student_id;
ALTER TABLE parent_student_relations RENAME COLUMN "createdAt" TO created_at;

-- topics
ALTER TABLE topics RENAME COLUMN "subjectId" TO subject_id;

-- questions
ALTER TABLE questions RENAME COLUMN "subjectId" TO subject_id;
ALTER TABLE questions RENAME COLUMN "topicId" TO topic_id;
ALTER TABLE questions RENAME COLUMN "tutorId" TO tutor_id;
ALTER TABLE questions RENAME COLUMN "contentText" TO content_text;
ALTER TABLE questions RENAME COLUMN "contentLatex" TO content_latex;
ALTER TABLE questions RENAME COLUMN "correctAnswer" TO correct_answer;
ALTER TABLE questions RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE questions RENAME COLUMN "updatedAt" TO updated_at;

-- exams
ALTER TABLE exams RENAME COLUMN "examType" TO exam_type;
ALTER TABLE exams RENAME COLUMN "durationMinutes" TO duration_minutes;
ALTER TABLE exams RENAME COLUMN "gradingType" TO grading_type;
ALTER TABLE exams RENAME COLUMN "createdBy" TO created_by;

-- exam_questions
ALTER TABLE exam_questions RENAME COLUMN "examId" TO exam_id;
ALTER TABLE exam_questions RENAME COLUMN "questionId" TO question_id;

-- exam_sessions
ALTER TABLE exam_sessions RENAME COLUMN "examId" TO exam_id;
ALTER TABLE exam_sessions RENAME COLUMN "studentId" TO student_id;
ALTER TABLE exam_sessions RENAME COLUMN "startTime" TO start_time;
ALTER TABLE exam_sessions RENAME COLUMN "endTime" TO end_time;
ALTER TABLE exam_sessions RENAME COLUMN "totalTimeSeconds" TO total_time_seconds;
ALTER TABLE exam_sessions RENAME COLUMN "finalScore" TO final_score;
ALTER TABLE exam_sessions RENAME COLUMN "rankingLevel" TO ranking_level;

-- student_answers
ALTER TABLE student_answers RENAME COLUMN "sessionId" TO session_id;
ALTER TABLE student_answers RENAME COLUMN "questionId" TO question_id;
ALTER TABLE student_answers RENAME COLUMN "studentAnswer" TO student_answer;
ALTER TABLE student_answers RENAME COLUMN "isCorrect" TO is_correct;
ALTER TABLE student_answers RENAME COLUMN "timeSpentSeconds" TO time_spent_seconds;
ALTER TABLE student_answers RENAME COLUMN "manualScore" TO manual_score;
ALTER TABLE student_answers RENAME COLUMN "tutorFeedback" TO tutor_feedback;
ALTER TABLE student_answers RENAME COLUMN "aiFeedback" TO ai_feedback;

-- practice_sessions
ALTER TABLE practice_sessions RENAME COLUMN "studentId" TO student_id;
ALTER TABLE practice_sessions RENAME COLUMN "topicId" TO topic_id;
ALTER TABLE practice_sessions RENAME COLUMN "sourceType" TO source_type;
ALTER TABLE practice_sessions RENAME COLUMN "assignedBy" TO assigned_by;
ALTER TABLE practice_sessions RENAME COLUMN "startedAt" TO started_at;
ALTER TABLE practice_sessions RENAME COLUMN "endedAt" TO ended_at;

-- practice_answers
ALTER TABLE practice_answers RENAME COLUMN "sessionId" TO session_id;
ALTER TABLE practice_answers RENAME COLUMN "questionId" TO question_id;
ALTER TABLE practice_answers RENAME COLUMN "studentAnswer" TO student_answer;
ALTER TABLE practice_answers RENAME COLUMN "isCorrect" TO is_correct;
ALTER TABLE practice_answers RENAME COLUMN "timeSpentSeconds" TO time_spent_seconds;

-- recommendations
ALTER TABLE recommendations RENAME COLUMN "studentId" TO student_id;
ALTER TABLE recommendations RENAME COLUMN "topicId" TO topic_id;
ALTER TABLE recommendations RENAME COLUMN "priorityScore" TO priority_score;
ALTER TABLE recommendations RENAME COLUMN "createdAt" TO created_at;

-- student_performances
ALTER TABLE student_performances RENAME COLUMN "studentId" TO student_id;
ALTER TABLE student_performances RENAME COLUMN "subjectId" TO subject_id;
ALTER TABLE student_performances RENAME COLUMN "topicId" TO topic_id;
ALTER TABLE student_performances RENAME COLUMN "scoreAvg" TO score_avg;
ALTER TABLE student_performances RENAME COLUMN "attemptCount" TO attempt_count;
ALTER TABLE student_performances RENAME COLUMN "lastUpdated" TO last_updated;

-- leaderboards
ALTER TABLE leaderboards RENAME COLUMN "studentId" TO student_id;
ALTER TABLE leaderboards RENAME COLUMN "calculatedAt" TO calculated_at;

-- flashcards
ALTER TABLE flashcards RENAME COLUMN "studentId" TO student_id;
ALTER TABLE flashcards RENAME COLUMN "questionId" TO question_id;
ALTER TABLE flashcards RENAME COLUMN "frontContent" TO front_content;
ALTER TABLE flashcards RENAME COLUMN "backContent" TO back_content;
ALTER TABLE flashcards RENAME COLUMN "createdAt" TO created_at;

-- flashcard_reviews
ALTER TABLE flashcard_reviews RENAME COLUMN "flashcardId" TO flashcard_id;
ALTER TABLE flashcard_reviews RENAME COLUMN "easeFactor" TO ease_factor;
ALTER TABLE flashcard_reviews RENAME COLUMN "intervalDays" TO interval_days;
ALTER TABLE flashcard_reviews RENAME COLUMN "nextReviewDate" TO next_review_date;

-- forum_posts
ALTER TABLE forum_posts RENAME COLUMN "authorId" TO author_id;
ALTER TABLE forum_posts RENAME COLUMN "targetAudience" TO target_audience;
ALTER TABLE forum_posts RENAME COLUMN "isAnonymous" TO is_anonymous;
ALTER TABLE forum_posts RENAME COLUMN "createdAt" TO created_at;

-- study_resources
ALTER TABLE study_resources RENAME COLUMN "resourceType" TO resource_type;
ALTER TABLE study_resources RENAME COLUMN "topicId" TO topic_id;
ALTER TABLE study_resources RENAME COLUMN "createdAt" TO created_at;

-- banners
ALTER TABLE banners RENAME COLUMN "imageUrl" TO image_url;
ALTER TABLE banners RENAME COLUMN "targetUrl" TO target_url;
ALTER TABLE banners RENAME COLUMN "isActive" TO is_active;
ALTER TABLE banners RENAME COLUMN "createdAt" TO created_at;

-- subscriptions
ALTER TABLE subscriptions RENAME COLUMN "userId" TO user_id;
ALTER TABLE subscriptions RENAME COLUMN "stripeCustomerId" TO stripe_customer_id;
ALTER TABLE subscriptions RENAME COLUMN "stripeSubscriptionId" TO stripe_subscription_id;
ALTER TABLE subscriptions RENAME COLUMN "currentPeriodEnd" TO current_period_end;

-- refresh_tokens
ALTER TABLE refresh_tokens RENAME COLUMN "userId" TO user_id;
ALTER TABLE refresh_tokens RENAME COLUMN "tokenHash" TO token_hash;
ALTER TABLE refresh_tokens RENAME COLUMN "expiresAt" TO expires_at;
ALTER TABLE refresh_tokens RENAME COLUMN "revokedAt" TO revoked_at;
ALTER TABLE refresh_tokens RENAME COLUMN "createdAt" TO created_at;
