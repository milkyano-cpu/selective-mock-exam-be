ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'FILE';
ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'VIDEO';

CREATE TABLE IF NOT EXISTS "resources" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "type" "ResourceType" NOT NULL,
  "file_url" TEXT,
  "video_url" TEXT,
  "file_name" TEXT,
  "file_size" INTEGER,
  "mime_type" TEXT,
  "uploaded_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "resources_uploaded_by_idx" ON "resources"("uploaded_by");
CREATE INDEX IF NOT EXISTS "resources_type_idx" ON "resources"("type");

ALTER TABLE "resources"
  ADD CONSTRAINT "resources_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
