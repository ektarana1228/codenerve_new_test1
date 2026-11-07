CREATE TABLE "MobilePairing" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "pairedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MobilePairing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobilePairing_sessionId_key" ON "MobilePairing"("sessionId");
CREATE UNIQUE INDEX "MobilePairing_tokenHash_key" ON "MobilePairing"("tokenHash");
CREATE INDEX "MobilePairing_expiresAt_idx" ON "MobilePairing"("expiresAt");
ALTER TABLE "MobilePairing" ADD CONSTRAINT "MobilePairing_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
