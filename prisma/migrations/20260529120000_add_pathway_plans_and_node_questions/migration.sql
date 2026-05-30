-- ==========================================================
-- PathwayPlan + PathwayNodeQuestion (SME-109, SME-111)
-- ==========================================================

-- CreateTable: pathway_plans
CREATE TABLE "pathway_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tutor_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pathway_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pathway_plans_tutor_id_idx" ON "pathway_plans"("tutor_id");
CREATE INDEX "pathway_plans_student_id_idx" ON "pathway_plans"("student_id");

ALTER TABLE "pathway_plans" ADD CONSTRAINT "pathway_plans_tutor_id_fkey"
    FOREIGN KEY ("tutor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pathway_plans" ADD CONSTRAINT "pathway_plans_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: add plan_id to student_pathways (nullable first for backfill)
ALTER TABLE "student_pathways" ADD COLUMN "plan_id" TEXT;

-- Backfill: every existing standalone pathway becomes its own plan (1:1).
-- The plan reuses the pathway id to keep the relationship trivially unique.
INSERT INTO "pathway_plans" ("id", "name", "tutor_id", "student_id", "created_at", "updated_at")
SELECT sp."id", 'Learning Plan', sp."tutor_id", sp."student_id", sp."created_at", CURRENT_TIMESTAMP
FROM "student_pathways" sp;

UPDATE "student_pathways" sp SET "plan_id" = sp."id";

-- Now enforce NOT NULL
ALTER TABLE "student_pathways" ALTER COLUMN "plan_id" SET NOT NULL;

-- Replace the old (student_id, subject_id) uniqueness with (plan_id, subject_id):
-- a subject may now appear in multiple plans, but only once per plan.
DROP INDEX "student_pathways_student_id_subject_id_key";
CREATE UNIQUE INDEX "student_pathways_plan_id_subject_id_key" ON "student_pathways"("plan_id", "subject_id");
CREATE INDEX "student_pathways_plan_id_idx" ON "student_pathways"("plan_id");

ALTER TABLE "student_pathways" ADD CONSTRAINT "student_pathways_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "pathway_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: pathway_node_questions
CREATE TABLE "pathway_node_questions" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pathway_node_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pathway_node_questions_node_id_idx" ON "pathway_node_questions"("node_id");
CREATE INDEX "pathway_node_questions_question_id_idx" ON "pathway_node_questions"("question_id");
CREATE UNIQUE INDEX "pathway_node_questions_node_id_question_id_key" ON "pathway_node_questions"("node_id", "question_id");
CREATE UNIQUE INDEX "pathway_node_questions_node_id_order_index_key" ON "pathway_node_questions"("node_id", "order_index");

ALTER TABLE "pathway_node_questions" ADD CONSTRAINT "pathway_node_questions_node_id_fkey"
    FOREIGN KEY ("node_id") REFERENCES "pathway_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pathway_node_questions" ADD CONSTRAINT "pathway_node_questions_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
