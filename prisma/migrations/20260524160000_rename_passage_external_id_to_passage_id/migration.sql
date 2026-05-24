-- Rename Passage.external_id to passage_id (human-readable identifier, auto-generated).
ALTER TABLE "passages" RENAME COLUMN "external_id" TO "passage_id";
ALTER INDEX "passages_external_id_key" RENAME TO "passages_passage_id_key";
