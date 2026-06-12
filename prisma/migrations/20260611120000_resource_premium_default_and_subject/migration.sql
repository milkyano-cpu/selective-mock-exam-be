-- Resources are a Premium-only feature (SME-124). New resources should default
-- to Premium-only visibility instead of being exposed to every tier.
-- This only changes the default for future inserts; existing rows are untouched.
ALTER TABLE "resources"
  ALTER COLUMN "allowed_tiers" SET DEFAULT ARRAY['PREMIUM']::"Tier"[];

-- Optional subject tag so resources can be filtered by subject in the library.
-- SetNull: deleting a subject keeps the resource, just clears its subject tag.
ALTER TABLE "resources" ADD COLUMN "subject_id" TEXT;

CREATE INDEX "resources_subject_id_idx" ON "resources"("subject_id");

ALTER TABLE "resources" ADD CONSTRAINT "resources_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
