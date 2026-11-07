-- Per-assessment AI assistant capability level, plus a per-session snapshot of it.
-- Additive only: one new type and two new columns, both NOT NULL with a default
-- so existing rows remain valid. No drops, no destructive statements.

CREATE TYPE "AiAssistantMode" AS ENUM ('AGENTIC', 'NON_AGENTIC', 'DISABLED');

-- Restrictive default so any row inserted outside the API fails closed.
ALTER TABLE "Assessment"
ADD COLUMN "aiAssistantMode" "AiAssistantMode" NOT NULL DEFAULT 'NON_AGENTIC';

ALTER TABLE "Session"
ADD COLUMN "aiAssistantMode" "AiAssistantMode" NOT NULL DEFAULT 'NON_AGENTIC';

-- Backfill assessments with the kind-based default. CODING already matches the
-- column default; PROJECT is where an agentic assistant is the intended experience.
UPDATE "Assessment" SET "aiAssistantMode" = 'AGENTIC' WHERE "kind" = 'PROJECT';

-- Every session that already exists ran under an unconditionally agentic
-- assistant, because that was the only behaviour available before this change.
-- Record what actually happened rather than what the new default would imply:
--   * already-scored attempts keep a truthful audit trail, and
--   * in-flight attempts are not silently downgraded mid-assessment.
UPDATE "Session" SET "aiAssistantMode" = 'AGENTIC';
