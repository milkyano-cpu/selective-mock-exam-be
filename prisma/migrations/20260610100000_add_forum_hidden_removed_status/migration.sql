-- Add HIDDEN and REMOVED moderation states to ForumStatus (SME-122).
-- HIDDEN: reversible hide (Tutor/Admin can restore). REMOVED: only Admin restores.
ALTER TYPE "ForumStatus" ADD VALUE IF NOT EXISTS 'HIDDEN';
ALTER TYPE "ForumStatus" ADD VALUE IF NOT EXISTS 'REMOVED';
