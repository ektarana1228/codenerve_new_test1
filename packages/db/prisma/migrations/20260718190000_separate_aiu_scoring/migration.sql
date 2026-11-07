ALTER TABLE "SessionScore" ADD COLUMN "aiuStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "SessionScore" ADD COLUMN "aiuScoringError" TEXT;

UPDATE "SessionScore" AS score
SET "totalScore" = score."codeCorrectnessScore",
    "aiuStatus" = CASE
      WHEN EXISTS (SELECT 1 FROM "InteractionLog" log WHERE log."sessionId" = score."sessionId") THEN 'COMPLETE'
      ELSE 'NO_AI_USED'
    END;
