-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "solutionFiles" JSONB;

-- AlterTable
ALTER TABLE "SessionScore" ADD COLUMN     "projectScores" JSONB;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "bugBankId" TEXT,
ADD COLUMN     "difficulty" "Difficulty";
