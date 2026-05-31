-- Add requiredTier to exams and isFreeTopic to topics.
-- Defaults keep existing data safe: exams default to BASIC, topics to false.
ALTER TABLE "exams"
ADD COLUMN "required_tier" "Tier" NOT NULL DEFAULT 'BASIC';

ALTER TABLE "topics"
ADD COLUMN "is_free_topic" BOOLEAN NOT NULL DEFAULT false;

-- Seed tier-related system settings.
INSERT INTO "system_settings" ("key", "value") VALUES
  ('BASIC_MOCK_EXAM_LIMIT',      '1'),
  ('BASIC_DAILY_PRACTICE_LIMIT', '5'),
  ('STANDARD_RETAKE_LIMIT',      '3'),
  ('PREMIUM_RETAKE_LIMIT',       '9999')
ON CONFLICT ("key") DO NOTHING;
