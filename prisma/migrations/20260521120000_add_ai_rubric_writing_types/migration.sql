-- CreateTable
CREATE TABLE "ai_rubric_writing_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_rubric_writing_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_rubric_writing_types_name_key" ON "ai_rubric_writing_types"("name");

-- Seed initial writing types
INSERT INTO "ai_rubric_writing_types" ("id", "name", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'CREATIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'PERSUASIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
