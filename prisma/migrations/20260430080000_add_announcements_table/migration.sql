-- Create announcements table
CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'URGENT');
CREATE TYPE "AnnouncementStatus" AS ENUM ('SCHEDULED', 'SENT');

CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
    "target" TEXT[],
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'SENT',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcements_status_scheduled_at_idx" ON "announcements"("status", "scheduled_at");
CREATE INDEX "announcements_created_at_idx" ON "announcements"("created_at");

ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
