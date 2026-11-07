UPDATE "SessionScore" AS score
SET "totalScore" = CASE
  WHEN assessment."kind" = 'CODING' THEN
    ROUND((
      score."codeCorrectnessScore" * assessment."codeWeight" / 100.0
      + score."aiuTotalScore" * assessment."aiuWeight" / 100.0
    )::numeric, 2)::double precision
  ELSE score."codeCorrectnessScore"
END
FROM "Session" AS session, "Assessment" AS assessment
WHERE score."sessionId" = session."id"
  AND session."assessmentId" = assessment."id";

ALTER TABLE "SessionScore" DROP COLUMN "aiuScoringError";
ALTER TABLE "SessionScore" DROP COLUMN "aiuStatus";
