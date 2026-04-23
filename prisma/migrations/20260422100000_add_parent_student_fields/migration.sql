-- Enums
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
CREATE TYPE "RelationshipType" AS ENUM ('MOTHER', 'FATHER', 'GUARDIAN', 'GRANDPARENT', 'OTHER');

-- User: parent + student fields
ALTER TABLE users ADD COLUMN phone_number TEXT;
ALTER TABLE users ADD COLUMN address TEXT;
ALTER TABLE users ADD COLUMN gender "Gender";
ALTER TABLE users ADD COLUMN year_level TEXT;

-- ParentStudentRelation: relationship type
ALTER TABLE parent_student_relations ADD COLUMN relationship_type "RelationshipType" NOT NULL DEFAULT 'OTHER';
ALTER TABLE parent_student_relations ALTER COLUMN relationship_type DROP DEFAULT;
