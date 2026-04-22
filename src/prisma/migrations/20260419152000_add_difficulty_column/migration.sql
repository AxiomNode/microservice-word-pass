ALTER TABLE "GameGeneration"
ADD COLUMN "difficultyPercentage" INTEGER;

UPDATE "GameGeneration"
SET "difficultyPercentage" = GREATEST(
  0,
  LEAST(100, CAST(("requestJson"::jsonb ->> 'difficulty_percentage') AS INTEGER))
)
WHERE ("requestJson"::jsonb ->> 'difficulty_percentage') ~ '^\\d+$';

CREATE INDEX "GameGeneration_gameType_difficultyPercentage_createdAt_idx"
ON "GameGeneration"("gameType", "difficultyPercentage", "createdAt");

CREATE INDEX "GameGeneration_gameType_language_categoryId_difficultyPercentage_createdAt_idx"
ON "GameGeneration"("gameType", "language", "categoryId", "difficultyPercentage", "createdAt");