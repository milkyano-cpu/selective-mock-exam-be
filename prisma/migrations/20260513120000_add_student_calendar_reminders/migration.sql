CREATE TABLE "student_calendar_reminders" (
  "id" TEXT NOT NULL,
  "student_id" TEXT NOT NULL,
  "reminder_date" DATE NOT NULL,
  "note" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "student_calendar_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_calendar_reminders_student_id_reminder_date_key"
  ON "student_calendar_reminders"("student_id", "reminder_date");

CREATE INDEX "student_calendar_reminders_student_id_reminder_date_idx"
  ON "student_calendar_reminders"("student_id", "reminder_date");

ALTER TABLE "student_calendar_reminders"
  ADD CONSTRAINT "student_calendar_reminders_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
