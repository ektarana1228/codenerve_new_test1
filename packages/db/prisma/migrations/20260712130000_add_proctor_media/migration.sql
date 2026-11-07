CREATE TABLE "ProctorMedia" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "driveFileId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProctorMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProctorMedia_driveFileId_key" ON "ProctorMedia"("driveFileId");
CREATE INDEX "ProctorMedia_sessionId_capturedAt_idx" ON "ProctorMedia"("sessionId", "capturedAt");
CREATE INDEX "ProctorMedia_expiresAt_idx" ON "ProctorMedia"("expiresAt");

ALTER TABLE "ProctorMedia"
ADD CONSTRAINT "ProctorMedia_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
