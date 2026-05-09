-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "passage_id" TEXT,
ADD COLUMN     "subtopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "time_limit_seconds" INTEGER;

-- CreateTable
CREATE TABLE "passages" (
    "id" TEXT NOT NULL,
    "external_id" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passages_external_id_key" ON "passages"("external_id");

-- CreateIndex
CREATE INDEX "questions_passage_id_idx" ON "questions"("passage_id");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_passage_id_fkey" FOREIGN KEY ("passage_id") REFERENCES "passages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
