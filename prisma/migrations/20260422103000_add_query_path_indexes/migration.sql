-- Indexes for high-traffic read paths introduced before implementing the full API surface.

CREATE INDEX "parent_student_relations_student_id_idx"
  ON "parent_student_relations"("student_id");

CREATE INDEX "topics_subject_id_idx"
  ON "topics"("subject_id");

CREATE INDEX "questions_subject_id_topic_id_status_difficulty_idx"
  ON "questions"("subject_id", "topic_id", "status", "difficulty");

CREATE INDEX "questions_tutor_id_status_idx"
  ON "questions"("tutor_id", "status");

CREATE INDEX "exam_sessions_student_id_exam_id_status_idx"
  ON "exam_sessions"("student_id", "exam_id", "status");

CREATE INDEX "exam_sessions_exam_id_status_idx"
  ON "exam_sessions"("exam_id", "status");

CREATE INDEX "student_answers_session_id_question_id_idx"
  ON "student_answers"("session_id", "question_id");

CREATE INDEX "practice_sessions_student_id_topic_id_source_type_idx"
  ON "practice_sessions"("student_id", "topic_id", "source_type");

CREATE INDEX "practice_sessions_assigned_by_idx"
  ON "practice_sessions"("assigned_by");

CREATE INDEX "practice_answers_session_id_question_id_idx"
  ON "practice_answers"("session_id", "question_id");

CREATE INDEX "recommendations_student_id_status_priority_score_idx"
  ON "recommendations"("student_id", "status", "priority_score");

CREATE INDEX "recommendations_topic_id_status_idx"
  ON "recommendations"("topic_id", "status");

CREATE INDEX "leaderboards_period_rank_idx"
  ON "leaderboards"("period", "rank");

CREATE INDEX "leaderboards_student_id_period_idx"
  ON "leaderboards"("student_id", "period");

CREATE INDEX "flashcards_student_id_created_at_idx"
  ON "flashcards"("student_id", "created_at");

CREATE INDEX "flashcard_reviews_next_review_date_idx"
  ON "flashcard_reviews"("next_review_date");

CREATE INDEX "refresh_tokens_jti_user_id_idx"
  ON "refresh_tokens"("jti", "user_id");
