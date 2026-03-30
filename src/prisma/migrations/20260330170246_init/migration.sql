-- CreateTable
CREATE TABLE "GameGeneration" (
    "id" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "uniquenessKey" TEXT,
    "batchRunId" TEXT,
    "requestJson" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameGeneration_uniquenessKey_key" ON "GameGeneration"("uniquenessKey");

-- CreateIndex
CREATE INDEX "GameGeneration_gameType_createdAt_idx" ON "GameGeneration"("gameType", "createdAt");

-- CreateIndex
CREATE INDEX "GameGeneration_gameType_language_categoryId_createdAt_idx" ON "GameGeneration"("gameType", "language", "categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "GameGeneration_gameType_categoryId_language_idx" ON "GameGeneration"("gameType", "categoryId", "language");
