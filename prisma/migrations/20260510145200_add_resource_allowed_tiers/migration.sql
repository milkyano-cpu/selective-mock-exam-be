ALTER TABLE "resources"
ADD COLUMN IF NOT EXISTS "allowed_tiers" "Tier"[] NOT NULL DEFAULT ARRAY['BASIC', 'STANDARD', 'PREMIUM']::"Tier"[];

CREATE INDEX IF NOT EXISTS "resources_allowed_tiers_idx" ON "resources" USING GIN ("allowed_tiers");
