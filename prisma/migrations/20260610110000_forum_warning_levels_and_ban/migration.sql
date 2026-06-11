-- SME-123: replace WarningLevel values (WARNING/SUSPEND -> MINOR/MAJOR/BAN) and
-- add a per-forum ban flag separate from account-wide status.

-- 1. Remap existing warning data to the new naming. The column is widened to
--    text first so we can write values present in neither the old nor new enum.
ALTER TABLE "forum_warnings" ALTER COLUMN "level" TYPE TEXT USING "level"::text;
UPDATE "forum_warnings" SET "level" = 'MINOR' WHERE "level" = 'WARNING';
UPDATE "forum_warnings" SET "level" = 'MAJOR' WHERE "level" = 'SUSPEND';

-- 2. Swap the enum type to the new set of values.
ALTER TYPE "WarningLevel" RENAME TO "WarningLevel_old";
CREATE TYPE "WarningLevel" AS ENUM ('MINOR', 'MAJOR', 'BAN');
ALTER TABLE "forum_warnings" ALTER COLUMN "level" TYPE "WarningLevel" USING "level"::"WarningLevel";
DROP TYPE "WarningLevel_old";

-- 3. Per-forum ban flag (does not touch account-wide users.status).
ALTER TABLE "users" ADD COLUMN "is_forum_banned" BOOLEAN NOT NULL DEFAULT false;
