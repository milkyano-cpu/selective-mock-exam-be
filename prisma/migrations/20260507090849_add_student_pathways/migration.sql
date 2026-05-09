-- AlterTable
ALTER TABLE "practice_sessions" ADD COLUMN     "pathway_node_id" TEXT;

-- CreateTable
CREATE TABLE "student_pathways" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "tutor_id" TEXT NOT NULL,
    "threshold_correct" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_pathways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pathway_nodes" (
    "id" TEXT NOT NULL,
    "pathway_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pathway_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pathway_node_progress" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "correct_answers" INTEGER NOT NULL DEFAULT 0,
    "total_attempts" INTEGER NOT NULL DEFAULT 0,
    "is_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pathway_node_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_pathways_student_id_idx" ON "student_pathways"("student_id");

-- CreateIndex
CREATE INDEX "student_pathways_tutor_id_idx" ON "student_pathways"("tutor_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_pathways_student_id_subject_id_key" ON "student_pathways"("student_id", "subject_id");

-- CreateIndex
CREATE INDEX "pathway_nodes_pathway_id_idx" ON "pathway_nodes"("pathway_id");

-- CreateIndex
CREATE UNIQUE INDEX "pathway_nodes_pathway_id_topic_id_key" ON "pathway_nodes"("pathway_id", "topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "pathway_nodes_pathway_id_order_index_key" ON "pathway_nodes"("pathway_id", "order_index");

-- CreateIndex
CREATE INDEX "pathway_node_progress_student_id_idx" ON "pathway_node_progress"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "pathway_node_progress_node_id_student_id_key" ON "pathway_node_progress"("node_id", "student_id");

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_pathway_node_id_fkey" FOREIGN KEY ("pathway_node_id") REFERENCES "pathway_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_pathways" ADD CONSTRAINT "student_pathways_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_pathways" ADD CONSTRAINT "student_pathways_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_pathways" ADD CONSTRAINT "student_pathways_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathway_nodes" ADD CONSTRAINT "pathway_nodes_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "student_pathways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathway_nodes" ADD CONSTRAINT "pathway_nodes_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathway_node_progress" ADD CONSTRAINT "pathway_node_progress_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "pathway_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pathway_node_progress" ADD CONSTRAINT "pathway_node_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
