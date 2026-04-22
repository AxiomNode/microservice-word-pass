import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../app/config.js";
import { ServiceMetrics } from "../app/services/serviceMetrics.js";

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

describe("ServiceMetrics", () => {
  it("tracks snapshots for traffic, generation, batch and process metrics", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(11_500);
    const metrics = new ServiceMetrics(createConfig());

    metrics.recordIncomingRequest({
      method: "POST",
      route: "/games/generate",
      statusCode: 201,
      durationMs: 125,
      requestBytes: 512,
      responseBytes: 1024,
    });
    metrics.recordOutboundRequest({
      operation: "generate",
      statusCode: 200,
      success: true,
      durationMs: 80,
      requestBytes: 120,
      responseBytes: 640,
    });
    metrics.recordOutboundRequest({
      operation: "catalogs",
      statusCode: 503,
      success: false,
      durationMs: 45,
      requestBytes: 64,
      responseBytes: 32,
    });
    metrics.recordGenerationStored();
    metrics.recordGenerationDuplicate("content");
    metrics.recordGenerationFailed();
    metrics.recordIngestedDocuments(3);
    metrics.recordBatch({ requested: 10, attempts: 14, created: 6, duplicates: 2, failed: 1, startedAt: "2026-04-22T00:00:00.000Z", finishedAt: "2026-04-22T00:05:00.000Z" } as never);
    metrics.recordGenerationProcessStarted(5);
    metrics.recordGenerationProcessCompleted({
      taskId: "task-1",
      status: "failed",
      requested: 5,
      processed: 5,
      created: 0,
      duplicates: 3,
      duplicateReasons: { content: 2 },
      failed: 2,
    } as never);
    metrics.recordAiAuthCircuitState({
      open: true,
      failureStreak: 3,
      failureThreshold: 3,
      openedUntil: "2026-04-22T01:00:00.000Z",
      cooldownMs: 300000,
      openedTotal: 1,
    });

    const snapshot = metrics.snapshot();

    expect(snapshot).toMatchObject({
      service: "microservice-wordpass",
      uptimeSeconds: 10,
      traffic: {
        requestsReceivedTotal: 1,
        outboundRequestsTotal: 2,
        outboundFailuresTotal: 1,
        requestBytesInTotal: 512,
        responseBytesOutTotal: 1024,
        outboundRequestBytesTotal: 184,
        outboundResponseBytesTotal: 672,
      },
      generation: {
        generatedStoredTotal: 7,
        generatedDuplicateTotal: 3,
        generatedDuplicateContentTotal: 1,
        generatedFailedTotal: 2,
        ingestedDocumentsTotal: 3,
        attemptsTotal: 12,
      },
      batch: {
        runsTotal: 1,
        requestedTotal: 10,
        attemptsTotal: 14,
        createdTotal: 6,
        duplicatesTotal: 2,
        failedTotal: 1,
      },
      processes: {
        startedTotal: 1,
        finishedTotal: 1,
        failedTotal: 1,
        requestedTotal: 5,
        createdTotal: 0,
        duplicatesTotal: 3,
        failedItemsTotal: 2,
        duplicateContentTotal: 2,
        onlyDuplicatesTotal: 0,
      },
      aiAuthCircuit: {
        open: true,
        failureStreak: 3,
        failureThreshold: 3,
        openedUntil: "2026-04-22T01:00:00.000Z",
        cooldownMs: 300000,
        openedTotal: 1,
      },
    });
    expect(snapshot.requestsByRoute).toEqual([
      { method: "POST", route: "/games/generate", statusCode: 201, total: 1 },
    ]);
    expect(snapshot.outboundByOperation).toEqual(
      expect.arrayContaining([
        { operation: "generate", statusCode: 200, total: 1 },
        { operation: "catalogs", statusCode: 503, total: 1 },
      ]),
    );

    nowSpy.mockRestore();
  });

  it("bounds logs and exports prometheus counters", () => {
    const metrics = new ServiceMetrics(createConfig({ METRICS_LOG_BUFFER_SIZE: 2 }));

    metrics.recordLog("info", "first");
    metrics.recordLog("warn", "second", { reason: "retry" });
    metrics.recordLog("error", "third", { reason: "boom" });
    metrics.recordGenerationProcessCompleted({
      taskId: "task-2",
      status: "completed",
      requested: 2,
      processed: 2,
      created: 0,
      duplicates: 2,
      duplicateReasons: { content: 1 },
      failed: 0,
    } as never);

    expect(metrics.recentLogs()).toHaveLength(2);
    expect(metrics.recentLogs(1)).toEqual([expect.objectContaining({ message: "generation_process_completed" })]);

    const prometheus = metrics.toPrometheus();

    expect(prometheus).toContain("microservice_requests_received_total 0");
    expect(prometheus).toContain("microservice_generation_process_only_duplicates_total 1");
    expect(prometheus).toContain("microservice_ai_auth_circuit_open 0");
  });

  it("returns zero generation ratios and exposes an open ai auth circuit", () => {
    const metrics = new ServiceMetrics(createConfig());

    metrics.recordAiAuthCircuitState({
      open: true,
      failureStreak: 2,
      failureThreshold: 3,
      cooldownMs: 300000,
      openedTotal: 4,
    });

    const snapshot = metrics.snapshot();
    const prometheus = metrics.toPrometheus();

    expect(snapshot.generation).toMatchObject({
      attemptsTotal: 0,
      successRatio: 0,
      duplicateRatio: 0,
      failureRatio: 0,
    });
    expect(snapshot.aiAuthCircuit).toMatchObject({
      open: true,
      openedUntil: null,
      openedTotal: 4,
    });
    expect(prometheus).toContain("microservice_ai_auth_circuit_open 1");
  });
});