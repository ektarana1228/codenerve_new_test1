-- Disabled is temporarily the only available AI coding assistant mode.
ALTER TABLE "Assessment" ALTER COLUMN "aiAssistantMode" SET DEFAULT 'DISABLED';
ALTER TABLE "Session" ALTER COLUMN "aiAssistantMode" SET DEFAULT 'DISABLED';

-- Close access for assessments and sessions created before this rollout.
UPDATE "Assessment" SET "aiAssistantMode" = 'DISABLED'
WHERE "aiAssistantMode" <> 'DISABLED';
UPDATE "Session" SET "aiAssistantMode" = 'DISABLED'
WHERE "aiAssistantMode" <> 'DISABLED';
