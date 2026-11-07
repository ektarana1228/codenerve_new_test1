-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('CODING', 'PROJECT');

-- AlterTable: PROJECT-kind assessment fields
ALTER TABLE "Assessment" ADD COLUMN     "allowedModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "connectionDetails" JSONB,
ADD COLUMN     "kind" "AssessmentKind" NOT NULL DEFAULT 'CODING',
ADD COLUMN     "submissionFiles" JSONB,
ADD COLUMN     "templateInfo" TEXT;

-- CreateTable: tasks for PROJECT-kind assessments
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "doneWhen" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_assessmentId_idx" ON "Task"("assessmentId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
