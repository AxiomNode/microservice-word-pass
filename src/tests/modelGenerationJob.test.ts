/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../app/config.js";
import { ModelGenerationJob } from "../app/services/modelGenerationJob.js";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    SERVICE_NAME: "microservice-wordpass",
    SERVICE_PORT: 7101,
    NODE_ENV: "test",
    AI_ENGINE_BASE_URL: "http://localhost:7001",
    AI_ENGINE_GENERATION_ENDPOINT: "/generate/word-pass",
    AI_ENGINE_INGEST_ENDPOINT: "/ingest/word-pass",
    AI_ENGINE_CATALOGS_ENDPOINT: "/catalogs",
    AI_ENGINE_INGEST_SOURCE: undefined,
    AI_ENGINE_API_KEY: undefined,
    AI_ENGINE_INGEST_API_KEY: undefined,
    AI_ENGINE_REQUEST_TIMEOUT_MS: 420000,
    AI_ENGINE_RETRY_MAX_ATTEMPTS: 8,
    AI_ENGINE_RETRY_INITIAL_DELAY_MS: 5000,
    AI_ENGINE_RETRY_MAX_DELAY_MS: 30000,
    AI_AUTH_CIRCUIT_FAILURE_THRESHOLD: 3,
    AI_AUTH_CIRCUIT_COOLDOWN_MS: 300000,
    PRIVATE_DOCS_ENABLED: false,
    PRIVATE_DOCS_PREFIX: "/private/docs",
    PRIVATE_DOCS_TOKEN: undefined,
    METRICS_LOG_BUFFER_SIZE: 2,
    BATCH_GENERATION_ENABLED: true,
    BATCH_GENERATION_INTERVAL_MINUTES: 20,
    BATCH_GENERATION_TARGET_COUNT: 40,
    BATCH_GENERATION_MAX_ATTEMPTS: 160,
    BATCH_GENERATION_CONCURRENCY: 2,
    BATCH_GENERATION_MIN_DIFFICULTY: 25,
    BATCH_GENERATION_MAX_DIFFICULTY: 85,
    BATCH_GENERATION_MIN_QUESTIONS: 5,
    BATCH_GENERATION_MAX_QUESTIONS: 10,
    DATABASE_URL: "postgresql://wordpass:wordpass@localhost:7433/wordpassdb?schema=public",
    ...overrides,
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ModelGenerationJob", () => {
  it("does not start scheduling when batch generation is disabled", () => {
    const logger = createLogger();
    const generationService = {
      runAiAuthSmokeCheck: vi.fn(),
      refreshCatalogs: vi.fn(),
      generateBatchModels: vi.fn(),
    };

    const job = new ModelGenerationJob(createConfig({ BATCH_GENERATION_ENABLED: false }), generationService as never);

    job.start(logger as never);

    expect(logger.info).toHaveBeenCalledWith("Periodic model generation disabled");
    expect(generationService.runAiAuthSmokeCheck).not.toHaveBeenCalled();
  });

  it("starts the scheduler, runs a startup cycle and can stop the interval", async () => {
    const logger = createLogger();
    const generationService = {
      runAiAuthSmokeCheck: vi.fn().mockResolvedValue({ ok: true }),
      refreshCatalogs: vi.fn().mockResolvedValue({ source: "seed", categories: [{ id: "1" }] }),
      generateBatchModels: vi.fn().mockResolvedValue({ requested: 4, attempts: 5, created: 3, duplicates: 1, failed: 0 }),
    };

    const timerHandle = { hasRef: () => true } as unknown as NodeJS.Timeout;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockReturnValue(timerHandle);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    const job = new ModelGenerationJob(createConfig({ BATCH_GENERATION_INTERVAL_MINUTES: 5 }), generationService as never);

    job.start(logger as never);
    await flushMicrotasks();

    expect(generationService.runAiAuthSmokeCheck).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ intervalMinutes: 5, targetCount: 40, maxAttempts: 160 }),
      "Periodic model generation scheduler started",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "startup", catalogSource: "seed", categoryCount: 1 }),
      "Periodic model generation cycle finished",
    );

    job.stop();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it("runs an interval cycle after the scheduler starts", async () => {
    vi.useFakeTimers();

    const logger = createLogger();
    const generationService = {
      runAiAuthSmokeCheck: vi.fn().mockResolvedValue({ ok: true }),
      refreshCatalogs: vi.fn().mockResolvedValue({ source: "seed", categories: [] }),
      generateBatchModels: vi.fn().mockResolvedValue({ requested: 1, attempts: 1, created: 1, duplicates: 0, failed: 0 }),
    };

    const job = new ModelGenerationJob(createConfig({ BATCH_GENERATION_INTERVAL_MINUTES: 1 }), generationService as never);

    job.start(logger as never);
    await flushMicrotasks();

    generationService.runAiAuthSmokeCheck.mockClear();
    generationService.refreshCatalogs.mockClear();
    generationService.generateBatchModels.mockClear();

    await vi.advanceTimersByTimeAsync(60_000);
    await flushMicrotasks();

    expect(generationService.runAiAuthSmokeCheck).toHaveBeenCalledTimes(1);
    expect(generationService.refreshCatalogs).toHaveBeenCalledTimes(1);
    expect(generationService.generateBatchModels).toHaveBeenCalledTimes(1);

    job.stop();
  });

  it("logs the message from thrown Error instances during a cycle", async () => {
    const logger = createLogger();
    const generationService = {
      runAiAuthSmokeCheck: vi.fn().mockResolvedValue({ ok: true }),
      refreshCatalogs: vi.fn().mockRejectedValue(new Error("catalog refresh failed")),
      generateBatchModels: vi.fn(),
    };

    const job = new ModelGenerationJob(createConfig(), generationService as never);

    await (job as any).runCycle(logger, "interval");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "interval", error: "catalog refresh failed" }),
      "Periodic model generation cycle failed",
    );
  });

  it("skips overlapping cycles, logs auth smoke failures and catches unknown errors", async () => {
    const logger = createLogger();
    const generationService = {
      runAiAuthSmokeCheck: vi.fn().mockResolvedValueOnce({ ok: false, reason: "unauthorized" }).mockRejectedValueOnce("boom"),
      refreshCatalogs: vi.fn(),
      generateBatchModels: vi.fn(),
    };

    const job = new ModelGenerationJob(createConfig(), generationService as never);

    await (job as any).runCycle(logger, "startup");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "startup", reason: "unauthorized" }),
      "Skipping periodic generation cycle because AI auth smoke check failed",
    );

    (job as any).running = true;
    await (job as any).runCycle(logger, "interval");
    expect(logger.warn).toHaveBeenCalledWith(
      { trigger: "interval" },
      "Skipping generation cycle because previous cycle is still running",
    );

    (job as any).running = false;
    await (job as any).runCycle(logger, "interval");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "interval", error: "Unknown error" }),
      "Periodic model generation cycle failed",
    );
  });
});