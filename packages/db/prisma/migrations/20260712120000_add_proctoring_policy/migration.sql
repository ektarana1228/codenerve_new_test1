CREATE TYPE "ProctoringMode" AS ENUM ('OFF', 'OPTIONAL', 'REQUIRED');

ALTER TABLE "Assessment"
ADD COLUMN "screenRecording" "ProctoringMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN "videoProctoring" "ProctoringMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN "microphoneRecording" "ProctoringMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN "secondCamera" "ProctoringMode" NOT NULL DEFAULT 'OFF';
