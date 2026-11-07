CREATE TYPE "AdminSignupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "AdminSignupRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "companyName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "AdminSignupStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AdminSignupRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminSignupRequest_email_idx" ON "AdminSignupRequest"("email");
CREATE INDEX "AdminSignupRequest_status_createdAt_idx" ON "AdminSignupRequest"("status", "createdAt");
