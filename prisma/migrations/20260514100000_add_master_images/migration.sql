-- CreateTable
CREATE TABLE "images" (
    "uuid" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "alt_text" TEXT,
    "caption" TEXT,
    "url" TEXT,
    "expired_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "images_pkey" PRIMARY KEY ("uuid")
);

-- AlterTable
ALTER TABLE "passages" ADD COLUMN "image_ref" TEXT;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN "image_ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "images_file_name_key" ON "images"("file_name");

-- CreateIndex
CREATE INDEX "images_expired_date_idx" ON "images"("expired_date");

-- CreateIndex
CREATE INDEX "passages_image_ref_idx" ON "passages"("image_ref");

-- CreateIndex
CREATE INDEX "questions_image_ref_idx" ON "questions"("image_ref");

-- AddForeignKey
ALTER TABLE "passages" ADD CONSTRAINT "passages_image_ref_fkey" FOREIGN KEY ("image_ref") REFERENCES "images"("file_name") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_image_ref_fkey" FOREIGN KEY ("image_ref") REFERENCES "images"("file_name") ON DELETE SET NULL ON UPDATE CASCADE;
