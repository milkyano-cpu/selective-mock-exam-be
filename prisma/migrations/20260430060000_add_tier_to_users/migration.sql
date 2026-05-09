-- Add Tier enum and tier column to users table
-- Default all existing users to BASIC

CREATE TYPE "Tier" AS ENUM ('BASIC', 'STANDARD', 'PREMIUM');

ALTER TABLE "users" ADD COLUMN "tier" "Tier" NOT NULL DEFAULT 'BASIC';
