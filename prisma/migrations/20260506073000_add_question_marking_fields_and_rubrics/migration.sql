CREATE TYPE "QuestionMarkingType" AS ENUM ('AUTO', 'RUBRIC');

ALTER TABLE "questions"
ADD COLUMN "marking_type" "QuestionMarkingType" NOT NULL DEFAULT 'AUTO',
ADD COLUMN "max_marks" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "rubric_id" TEXT;

CREATE TABLE "rubrics" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "writing_type" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "total_max_score" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rubric_criteria" (
  "id" TEXT NOT NULL,
  "rubric_id" TEXT NOT NULL,
  "criterion_name" TEXT NOT NULL,
  "criterion_description" TEXT NOT NULL,
  "max_score" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rubric_criteria_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rubric_band_descriptors" (
  "id" TEXT NOT NULL,
  "criterion_id" TEXT NOT NULL,
  "score_min" INTEGER NOT NULL,
  "score_max" INTEGER NOT NULL,
  "descriptor" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rubric_band_descriptors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rubrics_is_default_is_active_idx" ON "rubrics"("is_default", "is_active");
CREATE INDEX "rubrics_writing_type_idx" ON "rubrics"("writing_type");
CREATE INDEX "rubric_criteria_rubric_id_sort_order_idx" ON "rubric_criteria"("rubric_id", "sort_order");
CREATE INDEX "rubric_band_descriptors_criterion_id_score_min_score_max_idx" ON "rubric_band_descriptors"("criterion_id", "score_min", "score_max");
CREATE INDEX "questions_rubric_id_idx" ON "questions"("rubric_id");

ALTER TABLE "questions" ADD CONSTRAINT "questions_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "rubrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rubric_band_descriptors" ADD CONSTRAINT "rubric_band_descriptors_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "rubric_criteria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "rubrics" ("id", "name", "description", "writing_type", "is_default", "is_active", "total_max_score", "created_at", "updated_at") VALUES
('SELECTIVE_ENTRY_DEFAULT', 'Selective Entry Writing Default', 'Default writing rubric for selective entry essay questions.', 'selective_entry', true, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);