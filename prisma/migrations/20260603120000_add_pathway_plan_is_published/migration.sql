-- Add draft/publish state to pathway plans (SME-118).
-- Default false: every existing plan becomes a draft and must be published
-- manually by a tutor/admin after deploy, otherwise it disappears from the
-- student/parent view.
ALTER TABLE "pathway_plans"
ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT false;
