CREATE TABLE "ProctorEvent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProctorEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProctorEvent_sessionId_createdAt_idx" ON "ProctorEvent"("sessionId", "createdAt");
CREATE INDEX "ProctorEvent_expiresAt_idx" ON "ProctorEvent"("expiresAt");

ALTER TABLE "ProctorEvent"
ADD CONSTRAINT "ProctorEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
