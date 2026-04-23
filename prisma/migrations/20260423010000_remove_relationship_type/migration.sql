-- AlterTable
ALTER TABLE "parent_student_relations" DROP COLUMN "relationship_type";

-- DropEnum
DROP TYPE "RelationshipType";
