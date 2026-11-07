-- CreateTable
CREATE TABLE "LibraryProblem" (
    "id" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "topic" TEXT,
    "difficulty" "Difficulty" NOT NULL,
    "description" TEXT NOT NULL,
    "allowCopyPaste" BOOLEAN NOT NULL DEFAULT false,
    "language" "Language",
    "doneWhen" JSONB,
    "referenceFiles" JSONB,
    "solutionFiles" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryTestCase" (
    "id" TEXT NOT NULL,
    "libraryProblemId" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryTestCase_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LibraryProblem" ADD CONSTRAINT "LibraryProblem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryTestCase" ADD CONSTRAINT "LibraryTestCase_libraryProblemId_fkey" FOREIGN KEY ("libraryProblemId") REFERENCES "LibraryProblem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
