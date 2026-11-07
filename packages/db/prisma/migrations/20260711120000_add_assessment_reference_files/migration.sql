-- AlterTable: reference files seeded into the candidate's VS Code workspace
-- (PROJECT-kind). Stored as [{ path, contentBase64 }] JSON.
ALTER TABLE "Assessment" ADD COLUMN     "referenceFiles" JSONB;
