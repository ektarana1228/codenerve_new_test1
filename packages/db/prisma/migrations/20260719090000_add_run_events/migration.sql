CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RunEvent_sessionId_problemId_createdAt_idx"
ON "RunEvent"("sessionId", "problemId", "createdAt");

ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
