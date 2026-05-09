-- CreateEnum
CREATE TYPE "PassageType" AS ENUM ('TEXT', 'IMAGE', 'TEXT_IMAGE');

-- AlterTable
ALTER TABLE "passages" ADD COLUMN     "difficulty" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "latex_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "passage_type" "PassageType",
ADD COLUMN     "section" TEXT,
ADD COLUMN     "topic" TEXT,
ALTER COLUMN "content" DROP NOT NULL;
