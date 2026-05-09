/*
  Warnings:

  - Added the required column `email_encrypted` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "forum_posts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "forum_threads" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_encrypted" TEXT NOT NULL,
ADD COLUMN     "full_name_tokens" TEXT[] DEFAULT ARRAY[]::TEXT[];
