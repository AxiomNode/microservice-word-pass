import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("../app/db/client.js", () => ({
  prisma: {
    gameGeneration: {
      findMany: prismaMocks.findMany,
      findFirst: prismaMocks.findFirst,
      create: prismaMocks.create,
      deleteMany: prismaMocks.deleteMany,
      groupBy: prismaMocks.groupBy,
    },
  },
}));

import { GenerationService } from "../app/services/generationService.js";
import type { AppConfig } from "../app/config.js";

function createConfig(): AppConfig {
  return {
    SERVICE_NAME: "microservice-wordpass",
    SERVICE_PORT: 7200,
    NODE_ENV: "test",
    AI_ENGINE_BASE_URL: "http://localhost:7001",
    AI_ENGINE_GENERATION_ENDPOINT: "/generate/word-pass",
    AI_ENGINE_INGEST_ENDPOINT: "/ingest/word-pass",
    AI_ENGINE_CATALOGS_ENDPOINT: "/catalogs",
    AI_ENGINE_INGEST_SOURCE: "microservice-wordpass",
    AI_ENGINE_API_KEY: "test-key",
    AI_ENGINE_INGEST_API_KEY: "test-ingest-key",
    AI_ENGINE_REQUEST_TIMEOUT_MS: 420000,
    AI_ENGINE_RETRY_MAX_ATTEMPTS: 3,
    AI_ENGINE_RETRY_INITIAL_DELAY_MS: 1500,
    AI_ENGINE_RETRY_MAX_DELAY_MS: 12000,
    AI_AUTH_CIRCUIT_FAILURE_THRESHOLD: 3,
    AI_AUTH_CIRCUIT_COOLDOWN_MS: 300000,
    PRIVATE_DOCS_ENABLED: true,
    PRIVATE_DOCS_PREFIX: "/private/docs",
    PRIVATE_DOCS_TOKEN: "private-docs-token",
    METRICS_LOG_BUFFER_SIZE: 500,
    BATCH_GENERATION_ENABLED: true,
    BATCH_GENERATION_INTERVAL_MINUTES: 20,
    BATCH_GENERATION_TARGET_COUNT: 1000,
    BATCH_GENERATION_MAX_ATTEMPTS: 4000,
    BATCH_GENERATION_CONCURRENCY: 8,
    BATCH_GENERATION_MIN_DIFFICULTY: 25,
    BATCH_GENERATION_MAX_DIFFICULTY: 85,
    BATCH_GENERATION_MIN_QUESTIONS: 5,
    BATCH_GENERATION_MAX_QUESTIONS: 12,
    DATABASE_URL: "postgresql://wordpass:wordpass@localhost:7432/wordpassdb?schema=public",
  };
}

describe("GenerationService", () => {
  beforeEach(() => {
    prismaMocks.findMany.mockReset();
    prismaMocks.findFirst.mockReset();
    prismaMocks.create.mockReset();
    prismaMocks.deleteMany.mockReset();
    prismaMocks.groupBy.mockReset();
    vi.restoreAllMocks();
  });

  it("skips invalid persisted word-pass entries in randomModels instead of failing the whole request", async () => {
    const service = new GenerationService(createConfig());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    prismaMocks.findMany.mockResolvedValue([
      {
        id: "invalid-word-pass",
        gameType: "word-pass",
        query: "invalid rosco",
        language: "es",
        status: "created",
        categoryId: "9",
        categoryName: "General Knowledge",
        requestJson: JSON.stringify({ language: "es" }),
        responseJson: JSON.stringify({ game_type: "word-pass", game: { words: [] } }),
        createdAt: new Date("2026-04-15T18:00:00.000Z"),
      },
      {
        id: "valid-word-pass",
        gameType: "word-pass",
        query: "valid rosco",
        language: "es",
        status: "created",
        categoryId: "9",
        categoryName: "General Knowledge",
        requestJson: JSON.stringify({ language: "es" }),
        responseJson: JSON.stringify({
          game_type: "word-pass",
          game: {
            words: [
              {
                letter: "A",
                hint: "Primera letra",
                answer: "Atomo",
                starts_with: true,
              },
            ],
          },
        }),
        createdAt: new Date("2026-04-15T18:01:00.000Z"),
      },
    ]);

    const result = await service.randomModels({ count: 2, language: "es" });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("valid-word-pass");
    expect(result[0]?.request).toEqual({ language: "es" });
    expect(warnSpy).toHaveBeenCalledWith(
      "Skipping invalid stored word-pass model",
      "invalid-word-pass",
      "Generated word-pass has no words — rejecting incomplete content"
    );
  });

  it("keeps invalid persisted word-pass entries visible in history with a validation error", async () => {
    const service = new GenerationService(createConfig());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    prismaMocks.findMany.mockResolvedValue([
      {
        id: "invalid-word-pass",
        gameType: "word-pass",
        query: "invalid rosco",
        language: "es",
        status: "created",
        categoryId: "9",
        categoryName: "General Knowledge",
        requestJson: JSON.stringify({ language: "es" }),
        responseJson: JSON.stringify({ game_type: "word-pass", game: { words: [] } }),
        createdAt: new Date("2026-04-15T18:00:00.000Z"),
      },
      {
        id: "valid-word-pass",
        gameType: "word-pass",
        query: "valid rosco",
        language: "es",
        status: "created",
        categoryId: "9",
        categoryName: "General Knowledge",
        requestJson: JSON.stringify({ language: "es", item_count: "3" }),
        responseJson: JSON.stringify({
          game_type: "word-pass",
          game: {
            words: [
              {
                letter: "A",
                hint: "Primera letra",
                answer: "Atomo",
                starts_with: true,
              },
            ],
          },
        }),
        createdAt: new Date("2026-04-15T18:01:00.000Z"),
      },
    ]);

    const result = await service.history(10, { language: "es" });

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("invalid-word-pass");
    expect(result[0]?.responseValidationError).toBe(
      "Generated word-pass has no words — rejecting incomplete content"
    );
    expect(result[1]?.id).toBe("valid-word-pass");
    expect(result[1]?.request).toEqual({ language: "es", item_count: "3" });
    expect(warnSpy).toHaveBeenCalledWith(
      "Stored word-pass history item is invalid but still exposed for backoffice",
      "invalid-word-pass",
      "Generated word-pass has no words — rejecting incomplete content"
    );
  });
});