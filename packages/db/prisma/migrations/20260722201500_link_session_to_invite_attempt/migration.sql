-- A newly generated invite for the same candidate and assessment must create a
-- new attempt, while reopening the same invite must resume its existing attempt.
ALTER TABLE "Session" ADD COLUMN "inviteTokenId" TEXT;
CREATE UNIQUE INDEX "Session_inviteTokenId_key" ON "Session"("inviteTokenId");
ALTER TABLE "Session"
ADD CONSTRAINT "Session_inviteTokenId_fkey"
FOREIGN KEY ("inviteTokenId") REFERENCES "InviteToken"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
