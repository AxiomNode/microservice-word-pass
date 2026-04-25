/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildStoredRequestPayload } from "@axiomnode/shared-sdk-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("../app/db/client.js", () => ({
  prisma: {
    gameGeneration: {
      findMany: prismaMocks.findMany,
      findFirst: prismaMocks.findFirst,
      count: prismaMocks.count,
      create: prismaMocks.create,
      update: prismaMocks.update,
      deleteMany: prismaMocks.deleteMany,
      groupBy: prismaMocks.groupBy,
    },
  },
}));

import { GenerationService } from "../app/services/generationService.js";
import type { AppConfig } from "../app/config.js";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
    ...overrides,
  };
}

describe("GenerationService", () => {
  beforeEach(() => {
    prismaMocks.findMany.mockReset();
    prismaMocks.findFirst.mockReset();
    prismaMocks.count.mockReset();
    prismaMocks.create.mockReset();
    prismaMocks.update.mockReset();
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

    const result = await service.randomModels({ count: 2 });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("valid-word-pass");
    expect(result[0]?.request).toEqual({ language: "es" });
    expect(warnSpy).toHaveBeenCalledWith(
      "Skipping invalid stored word-pass model",
      "invalid-word-pass",
      "Generated word-pass has no words — rejecting incomplete content",
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

    const result = await service.history(10, {});

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("invalid-word-pass");
    expect(result[0]?.responseValidationError).toBe(
      "Generated word-pass has no words — rejecting incomplete content",
    );
    expect(result[1]?.id).toBe("valid-word-pass");
    expect(result[1]?.request).toEqual({ language: "es", item_count: "3" });
    expect(warnSpy).toHaveBeenCalledWith(
      "Stored word-pass history item is invalid but still exposed for backoffice",
      "invalid-word-pass",
      "Generated word-pass has no words — rejecting incomplete content",
    );
  });

  it("excludes pending_review word-pass entries from randomModels by default", async () => {
    const service = new GenerationService(createConfig());

    prismaMocks.findMany.mockResolvedValue([]);

    await service.randomModels({ count: 2 });

    expect(prismaMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          gameType: "word-pass",
          status: { not: "pending_review" },
        }),
      }),
    );
  });

  it("updates a word-pass history item and keeps editorial status", async () => {
    const service = new GenerationService(createConfig());

    prismaMocks.findFirst
      .mockResolvedValueOnce({
        id: "entry-3",
        gameType: "word-pass",
        query: "old",
        language: "es",
        status: "manual",
        categoryId: "9",
        categoryName: "General Knowledge",
        requestJson: JSON.stringify({ categoryId: "9", language: "es", difficulty_percentage: 40 }),
        responseJson: JSON.stringify({
          game_type: "word-pass",
          game: {
            words: [
              {
                letter: "V",
                hint: "Pista vieja",
                answer: "Vieja",
                starts_with: true,
              },
            ],
          },
        }),
        createdAt: new Date("2026-04-15T18:01:00.000Z"),
      })
      .mockResolvedValueOnce(null);

    prismaMocks.update.mockResolvedValue({
      id: "entry-3",
      gameType: "word-pass",
      query: "General Knowledge manual curation es difficulty 65",
      language: "es",
      status: "pending_review",
      categoryId: "9",
      categoryName: "General Knowledge",
      requestJson: JSON.stringify({ source: "backoffice-manual", categoryId: "9", language: "es", difficulty_percentage: 65 }),
      responseJson: JSON.stringify({
        game_type: "word-pass",
        game: {
          words: [
            {
              letter: "N",
              hint: "Pista nueva",
              answer: "Nueva",
              starts_with: true,
            },
          ],
        },
      }),
      createdAt: new Date("2026-04-15T18:01:00.000Z"),
    });

    const result = await service.updateHistoryItem("entry-3", {
      difficultyPercentage: 65,
      status: "pending_review",
      content: { words: [{ answer: "Nueva" }] },
    });

    expect(result?.status).toBe("pending_review");
    expect(prismaMocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "entry-3" },
        data: expect.objectContaining({
          status: "pending_review",
          difficultyPercentage: 65,
        }),
      }),
    );
  });

  it("pushes difficulty filtering down to Prisma in paged history", async () => {
    const service = new GenerationService(createConfig());
    prismaMocks.count.mockResolvedValue(1);
    prismaMocks.findMany.mockResolvedValue([]);

    await service.historyPage(500, { page: 2, pageSize: 25, difficultyPercentage: 60 });

    expect(prismaMocks.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          gameType: "word-pass",
          difficultyPercentage: 60,
        }),
      }),
    );
    expect(prismaMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          gameType: "word-pass",
          difficultyPercentage: 60,
        }),
        skip: 25,
        take: 25,
      }),
    );
  });

  it("omits generatedItems in process listings and only includes them on explicit detail requests", () => {
    const service = new GenerationService(createConfig());
    (service as any).generationProcesses.set("task-1", {
      taskId: "task-1",
      requestedBy: "backoffice",
      status: "completed",
      requested: 2,
      processed: 2,
      created: 2,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: "2026-04-19T10:00:00.000Z",
      updatedAt: "2026-04-19T10:01:00.000Z",
      finishedAt: "2026-04-19T10:01:00.000Z",
      generatedItems: [{ id: "wordpass-gen-1" }],
      errors: [],
    });

    const listed = service.listGenerationProcesses({ limit: 10 });
    const compact = service.getGenerationProcess("task-1", false);
    const detailed = service.getGenerationProcess("task-1", true);

    expect(listed[0]).not.toHaveProperty("generatedItems");
    expect(compact).not.toHaveProperty("generatedItems");
    expect(detailed).toHaveProperty("generatedItems", [{ id: "wordpass-gen-1" }]);
  });

  it("refreshes catalogs from ai-engine and falls back on smoke-check failures", async () => {
    const observer = { onAiAuthCircuitStateChanged: vi.fn() };
    const service = new GenerationService(createConfig(), observer);

    (service as any).client.getCatalogs = vi.fn()
      .mockResolvedValueOnce({
        categories: [{ id: "11", name: "Film" }],
        languages: [{ code: "ES", name: "Spanish" }],
      })
      .mockRejectedValueOnce(new Error("ai-engine error 401 unauthorized"));

    const refreshed = await service.refreshCatalogs();
    const smoke = await service.runAiAuthSmokeCheck();

    expect(refreshed).toMatchObject({
      source: "ai-engine",
      categories: [{ id: "11", name: "Film" }],
    });
    expect(service.getCatalogSnapshot().source).toBe("ai-engine");
    expect(smoke).toEqual({ ok: false, reason: "ai-engine error 401 unauthorized" });
    expect(observer.onAiAuthCircuitStateChanged).toHaveBeenCalled();
  });

  it("enforces and resets the AI auth circuit in assertAiGenerationAvailable", () => {
    const observer = { onAiAuthCircuitStateChanged: vi.fn() };
    const service = new GenerationService(createConfig(), observer);

    (service as any).aiAuthFailureStreak = 3;
    (service as any).aiAuthCircuitOpenedUntilMs = Date.now() + 60_000;

    expect(() => service.assertAiGenerationAvailable()).toThrow(/AI auth circuit open/i);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue((service as any).aiAuthCircuitOpenedUntilMs + 1);

    expect(() => service.assertAiGenerationAvailable()).not.toThrow();
    expect(service.getAiAuthCircuitSnapshot()).toMatchObject({ open: false, failureStreak: 0 });
    expect(observer.onAiAuthCircuitStateChanged).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("stores manual models, rejects duplicates, and deletes history entries", async () => {
    const service = new GenerationService(createConfig());

    prismaMocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "dup-1" });
    prismaMocks.create.mockResolvedValue({
      id: "manual-1",
      gameType: "word-pass",
      query: "General Knowledge manual curation es difficulty 45",
      language: "es",
      status: "validated",
      categoryId: "9",
      categoryName: "General Knowledge",
      requestJson: JSON.stringify({ source: "backoffice-manual" }),
      responseJson: JSON.stringify({
        game_type: "word-pass",
        game: {
          words: [
            {
              letter: "N",
              hint: "Pista",
              answer: "Nueva",
              starts_with: true,
            },
          ],
        },
      }),
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
    });
    prismaMocks.deleteMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const stored = await service.storeManualModel({
      categoryId: "9",
      difficultyPercentage: 45.8,
      content: { words: [{ letter: "N", hint: "Pista", answer: "Nueva", starts_with: true }] },
      status: "validated",
    });

    await expect(
      service.storeManualModel({
        categoryId: "9",
        difficultyPercentage: 45,
        content: { words: [{ letter: "N", hint: "Pista", answer: "Nueva", starts_with: true }] },
      }),
    ).rejects.toThrow("Duplicate content");

    await expect(service.deleteHistoryItem("missing")).resolves.toBe(false);
    await expect(service.deleteHistoryItem("manual-1")).resolves.toBe(true);

    expect(stored).toMatchObject({ id: "manual-1", status: "validated" });
    expect(prismaMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "validated",
          difficultyPercentage: 45,
        }),
      }),
    );
  });

  it("uses source precedence in ingestToRag and caches grouped summaries", async () => {
    const service = new GenerationService(createConfig());
    (service as any).client.ingest = vi.fn().mockResolvedValue({ ingested: 3 });
    prismaMocks.groupBy.mockResolvedValue([
      { categoryId: "9", categoryName: "General Knowledge", language: "es", _count: { _all: 2 } },
      { categoryId: "10", categoryName: "Books", language: "en", _count: { _all: 1 } },
    ]);

    const explicit = await service.ingestToRag([{ content: "A" }], "custom-source");
    const fallback = await service.ingestToRag([{ content: "B" }]);
    const firstGrouped = await service.groupedModelsSummary();
    const secondGrouped = await service.groupedModelsSummary();

    expect(explicit).toEqual({ ingested: 3 });
    expect(fallback).toEqual({ ingested: 3 });
    expect((service as any).client.ingest).toHaveBeenNthCalledWith(1, [{ content: "A" }], "custom-source");
    expect((service as any).client.ingest).toHaveBeenNthCalledWith(2, [{ content: "B" }], "microservice-wordpass");
    expect(firstGrouped.categories).toEqual(
      expect.arrayContaining([
        { categoryId: "9", categoryName: "General Knowledge", total: 2 },
      ]),
    );
    expect(secondGrouped).toEqual(firstGrouped);
    expect(prismaMocks.groupBy).toHaveBeenCalledTimes(1);
  });

  it("delegates generateAndStore through the resolved input pipeline", async () => {
    const service = new GenerationService(createConfig());
    (service as any).buildResolvedInput = vi.fn().mockReturnValue({
      categoryId: "9",
      difficultyPercentage: 15,
      numQuestions: 7,
      letters: "A,B,C",
      query: "resolved query",
    });
    (service as any).generateAndStoreWithResult = vi.fn().mockResolvedValue({
      stored: true,
      responsePayload: { id: "generated-1" },
    });

    const result = await service.generateAndStore({
      categoryId: "9",
      difficultyPercentage: 60,
      numQuestions: 4,
    });

    expect(result).toEqual({ id: "generated-1" });
    expect((service as any).generateAndStoreWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: "9",
        difficultyPercentage: 60,
        itemCount: 4,
        query: "resolved query",
      }),
    );
  });

  it("starts and completes generation processes while notifying observers", async () => {
    const observer = { onProcessStarted: vi.fn(), onProcessCompleted: vi.fn() };
    const service = new GenerationService(createConfig(), observer);

    (service as any).runGenerationProcess = vi.fn(async (taskId: string) => {
      const task = (service as any).generationProcesses.get(taskId);
      task.status = "completed";
      task.processed = 2;
      task.created = 1;
      task.duplicates = 1;
      task.duplicateByContent = 1;
      task.failed = 0;
      task.generatedItems.push({ id: "generated-1" });
      task.finishedAt = "2026-04-22T00:05:00.000Z";
      task.updatedAt = task.finishedAt;
      observer.onProcessCompleted((service as any).toGenerationProcessSnapshot(task, true));
    });

    const started = service.startGenerationProcess({ categoryId: "9", count: 2, requestedBy: "backoffice" });
    const completed = await service.runGenerationProcessBlocking({ categoryId: "9", count: 2 });

    expect(started).toMatchObject({ status: "completed", requestedBy: "backoffice", requested: 2 });
    expect(completed).toMatchObject({ status: "completed", created: 1, duplicates: 1 });
    expect(completed).toHaveProperty("generatedItems", [{ id: "generated-1" }]);
    expect(observer.onProcessStarted).toHaveBeenCalledTimes(2);
    expect(observer.onProcessCompleted).toHaveBeenCalledTimes(2);
  });

  it("aggregates batch generation results including duplicates and ai-auth circuit stops", async () => {
    const observer = { onBatchCompleted: vi.fn() };
    const service = new GenerationService(createConfig({ BATCH_GENERATION_CONCURRENCY: 1 }), observer);
    (service as any).buildDimensionMatrix = vi.fn().mockReturnValue([{ category: { id: "9", name: "General Knowledge" } }]);
    (service as any).buildResolvedInput = vi.fn().mockReturnValue({ categoryId: "9", query: "resolved" });
    (service as any).generateAndStoreWithResult = vi.fn()
      .mockResolvedValueOnce({ stored: true, responsePayload: {} })
      .mockResolvedValueOnce({ stored: false, duplicateReason: "content", responsePayload: {} })
      .mockRejectedValueOnce(new Error("AI auth circuit open until 2026-04-22T01:00:00.000Z"));

    const result = await service.generateBatchModels({ targetCount: 5, maxAttempts: 5 });

    expect(result).toMatchObject({ requested: 5, created: 1, duplicates: 1, failed: 1, attempts: 5 });
    expect(observer.onBatchCompleted).toHaveBeenCalledWith(expect.objectContaining({ created: 1, duplicates: 1, failed: 1 }));
  });

  it("covers internal helpers for uniqueness, normalization and parsing", () => {
    const service = new GenerationService(createConfig());
    const serviceAny = service as any;

    expect(serviceAny.normalizeManualContent({ words: [{ answer: "Nueva" }], notes: null })).toEqual({ words: [{ answer: "Nueva" }] });
    expect(() => serviceAny.normalizeManualContent({})).toThrow("Invalid content payload");
    expect(serviceAny.buildUniquenessKey("word-pass", {
      words: [{ answer: "Árbol" }],
    })).toBe(
      serviceAny.buildUniquenessKey("word-pass", {
        words: [{ answer: "arbol" }],
      }),
    );
    expect(serviceAny.extractDifficultyFromRequest({ difficulty_percentage: "120" })).toBe(100);
    expect(serviceAny.extractDifficultyFromRequest({ difficulty_percentage: -5 })).toBe(0);
    expect(serviceAny.extractDifficultyFromRequest("bad")).toBeUndefined();
    expect(serviceAny.parseStoredJsonSafely("not-json")).toMatchObject({ value: "not-json" });
    expect(serviceAny.validateStoredHistoryPayload({ game: { words: [] } }, "item-1", "word-pass")).toContain("Generated word-pass has no words");
    expect(serviceAny.stableStringify({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}');
    expect(() => serviceAny.getCategoryOrThrow("unknown")).toThrow("Unsupported categoryId: unknown");
    expect(serviceAny.extractAiEngineStatusCode(new Error("ai-engine error 403 forbidden"))).toBe(403);
    expect(serviceAny.extractAiEngineStatusCode("bad")).toBeNull();
    expect(serviceAny.isAiAuthCircuitOpenError(new Error("AI auth circuit open until tomorrow"))).toBe(true);
  });

  it("runs generation processes and aggregates created, duplicate and failed items", async () => {
    const observer = { onProcessCompleted: vi.fn() };
    const service = new GenerationService(createConfig(), observer);
    const serviceAny = service as any;

    serviceAny.generationProcesses.set("task-run", {
      taskId: "task-run",
      requestedBy: "api",
      status: "running",
      requested: 3,
      processed: 0,
      created: 0,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
      generatedItems: [],
      errors: [],
    });
    serviceAny.buildResolvedInput = vi.fn().mockReturnValue({ categoryId: "9", query: "resolved", numQuestions: 5 });
    serviceAny.generateAndStoreWithResult = vi.fn()
      .mockResolvedValueOnce({ stored: true, responsePayload: { id: "a" } })
      .mockResolvedValueOnce({ stored: false, duplicateReason: "content", responsePayload: { id: "b" } })
      .mockRejectedValueOnce(new Error("third failed"));

    await serviceAny.runGenerationProcess("task-run", { categoryId: "9", count: 3 });

    const finalTask = service.getGenerationProcess("task-run", true);
    expect(finalTask).toMatchObject({
      status: "completed",
      processed: 3,
      created: 1,
      duplicates: 1,
      failed: 1,
      duplicateReasons: { content: 1 },
    });
    expect(finalTask).toHaveProperty("generatedItems", [{ id: "a" }]);
    expect(finalTask).toHaveProperty("errors", ["third failed"]);
    expect(observer.onProcessCompleted).toHaveBeenCalled();
  });

  it("marks generation processes as failed when setup throws before processing items", async () => {
    const observer = { onProcessCompleted: vi.fn() };
    const service = new GenerationService(createConfig(), observer);
    const serviceAny = service as any;

    serviceAny.generationProcesses.set("task-fail", {
      taskId: "task-fail",
      requestedBy: "api",
      status: "running",
      requested: 2,
      processed: 0,
      created: 0,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
      generatedItems: [],
      errors: [],
    });
    serviceAny.getCategoryOrThrow = vi.fn(() => {
      throw new Error("Unsupported categoryId: xx");
    });

    await serviceAny.runGenerationProcess("task-fail", { categoryId: "xx", language: "es", count: 2 });

    expect(service.getGenerationProcess("task-fail")).toMatchObject({
      status: "failed",
      failed: 2,
      errors: ["Unsupported categoryId: xx"],
    });
    expect(observer.onProcessCompleted).toHaveBeenCalled();
  });

  it("prunes old completed processes but preserves running ones", () => {
    const service = new GenerationService(createConfig());
    const serviceAny = service as any;
    serviceAny.generationProcessRetentionLimit = 1;

    serviceAny.generationProcesses.set("done-old", {
      taskId: "done-old",
      requestedBy: "api",
      status: "completed",
      requested: 1,
      processed: 1,
      created: 1,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
      generatedItems: [],
      errors: [],
    });
    serviceAny.generationProcesses.set("running-new", {
      taskId: "running-new",
      requestedBy: "api",
      status: "running",
      requested: 1,
      processed: 0,
      created: 0,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
      generatedItems: [],
      errors: [],
    });

    serviceAny.pruneGenerationProcesses();

    expect(service.getGenerationProcess("done-old")).toBeNull();
    expect(service.getGenerationProcess("running-new")).not.toBeNull();
  });

  it("covers generateAndStoreWithResult for success, existing duplicates and Prisma duplicate races", async () => {
    const observer = {
      onModelStored: vi.fn(),
      onModelDuplicate: vi.fn(),
      onAiAuthCircuitStateChanged: vi.fn(),
    };
    const service = new GenerationService(createConfig(), observer);
    const serviceAny = service as any;

    serviceAny.aiAuthFailureStreak = 1;
    serviceAny.aiAuthCircuitOpenedUntilMs = Date.now() - 1;
    serviceAny.client.generate = vi.fn()
      .mockResolvedValueOnce({ game: { words: [{ letter: "A", hint: "Pista", answer: "Q", starts_with: true }] } })
      .mockResolvedValueOnce({ game: { words: [{ letter: "A", hint: "Pista", answer: "Q", starts_with: true }] } })
      .mockResolvedValueOnce({ game: { words: [{ letter: "B", hint: "Pista", answer: "Q2", starts_with: true }] } });
    prismaMocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "dup-existing" })
      .mockResolvedValueOnce(null);
    prismaMocks.create
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(Object.create(Prisma.PrismaClientKnownRequestError.prototype), { code: "P2002" }));

    const success = await serviceAny.generateAndStoreWithResult({
      categoryId: "9",
      query: "query",
      itemCount: 3,
      difficultyPercentage: 55,
    });
    const duplicate = await serviceAny.generateAndStoreWithResult({
      categoryId: "9",
      query: "query",
    });
    const racedDuplicate = await serviceAny.generateAndStoreWithResult({
      categoryId: "9",
      query: "query-2",
    });

    expect(success).toMatchObject({ stored: true });
    expect(duplicate).toMatchObject({ stored: false, duplicateReason: "content" });
    expect(racedDuplicate).toMatchObject({ stored: false, duplicateReason: "content" });
    expect(observer.onModelStored).toHaveBeenCalledTimes(1);
    expect(observer.onModelDuplicate).toHaveBeenCalledTimes(2);
    expect(observer.onAiAuthCircuitStateChanged).toHaveBeenCalled();
  });

  it("opens the AI auth circuit on 401 generation failures and ignores non-auth failures", async () => {
    const observer = { onModelFailed: vi.fn(), onAiAuthCircuitStateChanged: vi.fn() };
    const service = new GenerationService(createConfig(), observer);
    const serviceAny = service as any;
    serviceAny.aiAuthFailureThreshold = 1;
    serviceAny.aiAuthCircuitCooldownMs = 60000;

    serviceAny.client.generate = vi.fn()
      .mockRejectedValueOnce(new Error("ai-engine error 401 unauthorized"))
      .mockRejectedValueOnce(new Error("ai-engine error 500 upstream"));

    await expect(
      serviceAny.generateAndStoreWithResult({ categoryId: "9", query: "query" }),
    ).rejects.toThrow("ai-engine error 401 unauthorized");
    await expect(
      serviceAny.generateAndStoreWithResult({ categoryId: "9", query: "query" }),
    ).rejects.toThrow("AI auth circuit open until");

    expect(service.getAiAuthCircuitSnapshot()).toMatchObject({ open: true, failureStreak: 1, openedTotal: 1 });
    expect(observer.onModelFailed).toHaveBeenCalledTimes(1);
    expect(observer.onAiAuthCircuitStateChanged).toHaveBeenCalled();
  });

  it("covers updateHistoryItem edge cases and extra helper branches", async () => {
    const service = new GenerationService(createConfig());
    const serviceAny = service as any;

    prismaMocks.findFirst
      .mockResolvedValueOnce({
        id: "entry-1",
        gameType: "word-pass",
        query: "old",
        language: "es",
        status: "manual",
        categoryId: null,
        categoryName: null,
        difficultyPercentage: null,
        requestJson: JSON.stringify({}),
        responseJson: JSON.stringify({ game: { words: [{ letter: "A", hint: "Pista", answer: "Q", starts_with: true }] } }),
        createdAt: new Date("2026-04-15T18:01:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "entry-2",
        gameType: "word-pass",
        query: "old",
        language: "es",
        status: "manual",
        categoryId: "9",
        categoryName: "General Knowledge",
        difficultyPercentage: 40,
        requestJson: JSON.stringify({}),
        responseJson: JSON.stringify({ game: { words: [{ letter: "A", hint: "Pista", answer: "Q", starts_with: true }] } }),
        createdAt: new Date("2026-04-15T18:01:00.000Z"),
      })
      .mockResolvedValueOnce({ id: "dup-id" });

    await expect(service.updateHistoryItem("entry-1", { status: "validated" })).rejects.toThrow("Category is required");
    await expect(service.updateHistoryItem("entry-2", { status: "validated" })).rejects.toThrow("Duplicate content");

    expect(service.listGenerationProcesses({ status: "failed", requestedBy: "backoffice", limit: 0 })).toEqual([]);
    expect(buildStoredRequestPayload({ query: "x" }, { id: "9", name: "General Knowledge" })).toEqual({
      query: "x",
      category_id: "9",
      category_name: "General Knowledge",
    });
    expect(serviceAny.extractPrimaryContentSignature("word-pass", { words: [{ answer: "Árbol" }, { answer: "Casa" }] })).toBe("arbol|casa");
    expect(serviceAny.extractStringArrayFromObjects({ words: [{ answer: "Uno" }, { nope: true }] }, "words", "answer")).toEqual(["Uno"]);
    expect(serviceAny.extractStringArrayFromObjects({ game: { words: [{ answer: "Dos" }] } }, "words", "answer")).toEqual(["Dos"]);
    expect(
      serviceAny.buildPrimaryWordpassText(
        { game: { words: [{ hint: "Definicion de casa: termino comun.", answer: "casa" }] } },
        "fallback",
      ),
    ).toBe("Definicion de casa: termino comun.");
    expect(serviceAny.parseJson("not-json")).toBe("not-json");
    expect(serviceAny.resolveRequestedItemCount({ itemCount: 3, numQuestions: 7 })).toBe(3);
    expect(serviceAny.resolveRequestedItemCount({ numQuestions: 7 })).toBe(7);
  });

  it("covers smoke-check success and unknown ai-engine failures", async () => {
    const service = new GenerationService(createConfig());
    const serviceAny = service as any;

    serviceAny.client.getCatalogs = vi.fn()
      .mockResolvedValueOnce({ categories: [], languages: [] })
      .mockRejectedValueOnce("boom");

    await expect(service.runAiAuthSmokeCheck()).resolves.toEqual({ ok: true });
    await expect(service.runAiAuthSmokeCheck()).resolves.toEqual({ ok: false, reason: "Unknown ai-engine error" });
  });

  it("covers default branches for manual storage, missing updates and auxiliary filters", async () => {
    const service = new GenerationService(createConfig({ AI_ENGINE_INGEST_SOURCE: undefined }));
    const serviceAny = service as any;

    prismaMocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaMocks.create.mockResolvedValueOnce({
      id: "manual-default",
      gameType: "word-pass",
      query: "General Knowledge manual curation es difficulty 35",
      language: "es",
      status: "manual",
      categoryId: "9",
      categoryName: "General Knowledge",
      requestJson: JSON.stringify({ source: "backoffice-manual" }),
      responseJson: JSON.stringify({ words: [{ letter: "A", hint: "Pista", answer: "Algo", starts_with: true }] }),
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
    });
    prismaMocks.findMany.mockResolvedValue([]);
    prismaMocks.count.mockResolvedValue(0);
    serviceAny.client.ingest = vi.fn().mockResolvedValue({ ingested: 1 });

    const stored = await service.storeManualModel({
      categoryId: "9",
      difficultyPercentage: 35,
      content: { words: [{ letter: "A", hint: "Pista", answer: "Algo", starts_with: true }] },
    });
    const missingUpdate = await service.updateHistoryItem("missing", { status: "validated" });
    await service.randomModels({
      count: 3,
      categoryId: "9",
      status: "validated",
      difficultyPercentage: 45,
      createdAfter: new Date("2026-04-01T00:00:00.000Z"),
      createdBefore: new Date("2026-04-30T00:00:00.000Z"),
    });
    await service.history(10, { categoryId: "9", difficultyPercentage: 55 });
    await service.historyPage();
    await service.ingestToRag([{ content: "A" }]);

    expect(stored.status).toBe("manual");
    expect(missingUpdate).toBeNull();
    expect(prismaMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "manual" })
      })
    );
    expect(prismaMocks.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: "9",
          status: "validated",
          difficultyPercentage: 45,
          createdAt: expect.objectContaining({
            gte: new Date("2026-04-01T00:00:00.000Z"),
            lte: new Date("2026-04-30T00:00:00.000Z"),
          }),
        }),
      })
    );
    expect(prismaMocks.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: "9",
          difficultyPercentage: 55,
        }),
      })
    );
    expect(prismaMocks.count).toHaveBeenCalledWith(expect.objectContaining({ where: { gameType: "word-pass" } }));
    expect(prismaMocks.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ skip: 0, take: 20 })
    );
    expect(serviceAny.client.ingest).toHaveBeenCalledWith([{ content: "A" }], "microservice-wordpass");
  });

  it("covers generation process defaults, filters and missing-task branches", async () => {
    const service = new GenerationService(createConfig());
    const serviceAny = service as any;

    serviceAny.runGenerationProcess = vi.fn();
    const started = service.startGenerationProcess({ categoryId: "9", count: 2 });

    serviceAny.generationProcesses.set("failed-task", {
      taskId: "failed-task",
      requestedBy: "api",
      status: "failed",
      requested: 1,
      processed: 1,
      created: 0,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 1,
      startedAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
      generatedItems: [],
      errors: [],
    });
    serviceAny.generationProcesses.set("backoffice-task", {
      taskId: "backoffice-task",
      requestedBy: "backoffice",
      status: "completed",
      requested: 1,
      processed: 1,
      created: 1,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
      generatedItems: [],
      errors: [],
    });

    const defaultList = service.listGenerationProcesses();
    const filteredStatus = service.listGenerationProcesses({ status: "failed" });
    const filteredRequester = service.listGenerationProcesses({ requestedBy: "backoffice" });
    const missing = service.getGenerationProcess("missing-task");
    await serviceAny.runGenerationProcess("missing-task", { categoryId: "9", language: "es", count: 1 });

    expect(started.requestedBy).toBe("api");
    expect(defaultList.length).toBeGreaterThan(0);
    expect(filteredStatus).toEqual([expect.objectContaining({ taskId: "failed-task" })]);
    expect(filteredRequester).toEqual([expect.objectContaining({ taskId: "backoffice-task" })]);
    expect(missing).toBeNull();
  });

  it("covers failure-only and unknown-error branches in runGenerationProcess", async () => {
    const observer = { onProcessCompleted: vi.fn() };
    const service = new GenerationService(createConfig(), observer);
    const serviceAny = service as any;

    serviceAny.generationProcesses.set("task-only-failures", {
      taskId: "task-only-failures",
      requestedBy: "api",
      status: "running",
      requested: 1,
      processed: 0,
      created: 0,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
      generatedItems: [],
      errors: [],
    });
    serviceAny.buildResolvedInput = vi.fn().mockReturnValue({ categoryId: "9", language: "es", query: "resolved", numQuestions: 5 });
    serviceAny.generateAndStoreWithResult = vi.fn().mockRejectedValueOnce("boom");

    await serviceAny.runGenerationProcess("task-only-failures", { categoryId: "9", language: "es", count: 1 });

    expect(service.getGenerationProcess("task-only-failures")).toMatchObject({
      status: "failed",
      failed: 1,
      errors: ["Generation failed"],
    });

    serviceAny.generationProcesses.set("task-invalid-input", {
      taskId: "task-invalid-input",
      requestedBy: "api",
      status: "running",
      requested: 1,
      processed: 0,
      created: 0,
      duplicates: 0,
      duplicateByContent: 0,
      failed: 0,
      startedAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
      generatedItems: [],
      errors: [],
    });
    serviceAny.getCategoryOrThrow = vi.fn(() => {
      throw "bad-input";
    });

    await serviceAny.runGenerationProcess("task-invalid-input", { categoryId: "9", language: "es", count: 1 });

    expect(service.getGenerationProcess("task-invalid-input")).toMatchObject({
      status: "failed",
      failed: 1,
      errors: ["Invalid generation input"],
    });
  });

  it("covers helper edge branches for sanitization and parsing", () => {
    const service = new GenerationService(createConfig());
    const serviceAny = service as any;

    expect(() => serviceAny.sanitizeGeneratedPayload(null)).toThrow("Generated payload is not a valid object");
    expect(serviceAny.sanitizeGeneratedPayload({ words: [{ letter: "A", hint: "Pista", answer: "Algo" }] })).toEqual({ words: [{ letter: "A", hint: "Pista", answer: "Algo" }] });
    expect(() => serviceAny.sanitizeGeneratedPayload({ words: [{ hint: "Pista", answer: "Algo" }] })).toThrow("missing the 'letter'");
    expect(() => serviceAny.sanitizeGeneratedPayload({ words: [{ letter: "A", answer: "Algo" }] })).toThrow("missing the 'hint'");
    expect(() => serviceAny.sanitizeGeneratedPayload({ words: [{ letter: "A", hint: "Pista" }] })).toThrow("missing the 'answer'");
    expect(() => serviceAny.normalizeManualContent({ a: 1 })).toThrow("Invalid content payload");
    expect(serviceAny.extractPrimaryContentSignature("quiz", { questions: [{ question: "Uno" }, { question: "Dos" }] })).toBe("uno|dos");
    expect(serviceAny.extractPrimaryContentSignature("word-pass", null)).toBeNull();
    expect(serviceAny.extractStringArrayFromObjects({ words: [null, { answer: "Uno" }] }, "words", "answer")).toEqual(["Uno"]);
    expect(serviceAny.extractAiEngineStatusCode(new Error("plain network error"))).toBeNull();
  });
});
