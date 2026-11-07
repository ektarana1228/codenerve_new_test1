-- Existing assessments created before the Project Library starter-file backfill
-- must receive the same starter file as their matching task. Only assessments
-- with no starter files are touched; existing content is never overwritten.
UPDATE "Assessment" AS assessment
SET "referenceFiles" = source."referenceFiles"
FROM "LibraryProblem" AS source
WHERE assessment."kind" = 'PROJECT'
  AND source."kind" = 'PROJECT'
  AND (assessment."referenceFiles" IS NULL OR assessment."referenceFiles" = '[]'::jsonb)
  AND source."referenceFiles" IS NOT NULL
  AND source."referenceFiles" <> '[]'::jsonb
  AND EXISTS (
    SELECT 1
    FROM "Task" AS task
    WHERE task."assessmentId" = assessment."id"
      AND task."title" = source."title"
  );
