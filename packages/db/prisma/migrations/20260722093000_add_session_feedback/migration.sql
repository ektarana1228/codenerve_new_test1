CREATE TABLE "SessionFeedback" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "overallExperience" INTEGER NOT NULL,
  "instructionsClarity" INTEGER NOT NULL,
  "difficultyRelevance" INTEGER NOT NULL,
  "platformUsability" INTEGER NOT NULL,
  "technicalPerformance" INTEGER NOT NULL,
  "codingEnvironment" INTEGER NOT NULL,
  "aiAssistantUsefulness" INTEGER NOT NULL,
  "aiAssistantUsage" TEXT,
  "proctoringExperience" INTEGER NOT NULL,
  "fairness" INTEGER NOT NULL,
  "recommendationScore" INTEGER NOT NULL,
  "assessmentName" TEXT,
  "taskWhereIssueOccurred" TEXT,
  "technicalIssueType" TEXT,
  "mayContact" BOOLEAN NOT NULL DEFAULT false,
  "comments" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SessionFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionFeedback_sessionId_key" ON "SessionFeedback"("sessionId");
CREATE INDEX "SessionFeedback_sessionId_idx" ON "SessionFeedback"("sessionId");

ALTER TABLE "SessionFeedback"
ADD CONSTRAINT "SessionFeedback_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
