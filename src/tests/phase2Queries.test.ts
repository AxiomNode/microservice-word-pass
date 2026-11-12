/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("../app/db/client.js", () => ({
  prisma: {
    gameGeneration: {
      findMany: prismaMocks.findMany,
      count: prismaMocks.count,
      groupBy: prismaMocks.groupBy,
    },
  },
}));

import { gameRoutes } from "../app/routes/games.js";
import { healthRoutes } from "../app/routes/health.js";
import { GenerationService } from "../app/services/generationService.js";
import { RuntimeGenerationWorker } from "../app/services/runtimeGenerationWorker.js";
import { startListeningFirst } from "../app/services/startup.js";

function createConfig(): any {
  return {
    SERVICE_NAME: "microservice-wordpass",
    SERVICE_PORT: 7100,
    NODE_ENV: "test",
    AI_ENGINE_BASE_URL: "http://localhost:7001",
    AI_ENGINE_GENERATION_ENDPOINT: "/generate/word-pass",
    AI_ENGINE_INGEST_ENDPOINT: "/ingest/word-pass",
    AI_ENGINE_CATALOGS_ENDPOINT: "/catalogs",
    AI_ENGINE_API_KEY: "test-key",
    AI_ENGINE_REQUEST_TIMEOUT_MS: 1000,
    GAME_GENERATION_ITEM_TIMEOUT_MS: 1000,
    GAME_GENERATION_ITEM_RETRY_MAX_ATTEMPTS: 1,
    AI_ENGINE_RETRY_MAX_ATTEMPTS: 1,
    AI_ENGINE_RETRY_INITIAL_DELAY_MS: 0,
    AI_ENGINE_RETRY_MAX_DELAY_MS: 0,
    AI_AUTH_CIRCUIT_FAILURE_THRESHOLD: 3,
    AI_AUTH_CIRCUIT_COOLDOWN_MS: 1000,
    DATABASE_URL: "postgresql://unused",
  };
}

function validRow(id: string) {
  return {
    id,
    gameType: "word-pass",
    query: `q-${id}`,
    status: "created",
    categoryId: "9",
    categoryName: "General Knowledge",
    difficultyPercentage: 50,
    requestJson: JSON.stringify({}),
    responseJson: JSON.stringify({
      game_type: "word-pass",
      game: { words: [{ letter: "A", hint: "Primera letra", answer: "Atomo", starts_with: true }] },
    }),
    createdAt: new Date("2026-04-15T18:01:00.000Z"),
  };
}

beforeEach(() => {
  prismaMocks.findMany.mockReset();
  prismaMocks.count.mockReset();
  prismaMocks.groupBy.mockReset();
});

describe("randomModels two-step sampling", () => {
  it("samples ids only from a bounded pool and then loads full rows for the winners", async () => {
    const service = new GenerationService(createConfig());
    const pool = Array.from({ length: 300 }, (_, index) => ({ id: `id-${index}` }));
    prismaMocks.findMany.mockImplementation(async (args: any) => {
      if (args.select?.id === true && Object.keys(args.select).length === 1) {
        return pool;
      }
      return (args.where.id.in as string[]).map(validRow);
    });

    const result = await service.randomModels({ count: 2 });

    expect(prismaMocks.findMany).toHaveBeenCalledTimes(2);
    const [poolCall, rowsCall] = prismaMocks.findMany.mock.calls.map((call) => call[0]);
    // the pool query reads ids only: no JSON blobs, same filters/order/bound as before
    expect(poolCall.select).toEqual({ id: true });
    expect(poolCall.orderBy).toEqual({ createdAt: "desc" });
    expect(poolCall.take).toBe(300);
    expect(poolCall.where).toMatchObject({ gameType: "word-pass", status: { not: "pending_review" } });
    // the second query loads full rows for exactly `count` ids
    expect(rowsCall.where.id.in).toHaveLength(2);
    expect(rowsCall.select).toMatchObject({ requestJson: true, responseJson: true });
    expect(result).toHaveLength(2);
    // result order follows the random pick, not the database order
    expect(result.map((item) => item.id)).toEqual(rowsCall.where.id.in);
  });

  it("returns an empty list without a second query when the pool is empty", async () => {
    const service = new GenerationService(createConfig());
    prismaMocks.findMany.mockResolvedValue([]);

    await expect(service.randomModels({ count: 5 })).resolves.toEqual([]);
    expect(prismaMocks.findMany).toHaveBeenCalledTimes(1);
  });

  it("tolerates rows deleted between the two queries", async () => {
    const service = new GenerationService(createConfig());
    prismaMocks.findMany
      .mockResolvedValueOnce([{ id: "a" }, { id: "b" }])
      .mockResolvedValueOnce([validRow("a")]);

    const result = await service.randomModels({ count: 2 });
    expect(result.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("historyInsights", () => {
  it("groups by category with the same filters as the history page", async () => {
    const service = new GenerationService(createConfig());
    prismaMocks.groupBy.mockResolvedValue([
      { categoryId: "9", categoryName: "General Knowledge", _count: { _all: 3 }, _max: { createdAt: new Date("2026-04-01T00:00:00.000Z") } },
      { categoryId: "17", categoryName: "Science", _count: { _all: 2 }, _max: { createdAt: new Date("2026-05-01T00:00:00.000Z") } },
      { categoryId: null, categoryName: null, _count: { _all: 1 }, _max: { createdAt: null } },
    ]);

    const result = await service.historyInsights({ categoryId: "9", difficultyPercentage: 40, status: "validated" });

    expect(prismaMocks.groupBy).toHaveBeenCalledWith({
      by: ["categoryId", "categoryName"],
      where: { gameType: "word-pass", categoryId: "9", status: "validated", difficultyPercentage: 40 },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    expect(result.total).toBe(6);
    // newest bucket first, buckets without rows dates last
    expect(result.categories.map((item) => item.categoryId)).toEqual(["17", "9", null]);
    expect(result.categories[0]).toEqual({
      categoryId: "17",
      categoryName: "Science",
      count: 2,
      latestCreatedAt: "2026-05-01T00:00:00.000Z",
    });
  });

  it("orders buckets with and without dates deterministically", async () => {
    const service = new GenerationService(createConfig());
    prismaMocks.groupBy.mockResolvedValue([
      { categoryId: "a", categoryName: "A", _count: { _all: 1 }, _max: { createdAt: null } },
      { categoryId: "b", categoryName: "B", _count: { _all: 1 }, _max: { createdAt: new Date("2026-01-01T00:00:00.000Z") } },
      { categoryId: "c", categoryName: "C", _count: { _all: 1 }, _max: { createdAt: null } },
    ]);
    const result = await service.historyInsights();
    expect(result.categories[0]?.categoryId).toBe("b");
  });

  it("returns an empty aggregate for an empty table", async () => {
    const service = new GenerationService(createConfig());
    prismaMocks.groupBy.mockResolvedValue([]);
    await expect(service.historyInsights()).resolves.toEqual({ total: 0, categories: [] });
  });
});

describe("GET /games/history/insights", () => {
  function stubService() {
    return {
      assertAiGenerationAvailable: vi.fn(),
      generateAndStore: vi.fn(),
      startGenerationProcess: vi.fn(),
      runGenerationProcessBlocking: vi.fn(),
      listGenerationProcesses: vi.fn().mockReturnValue([]),
      getGenerationProcess: vi.fn(),
      ingestToRag: vi.fn(),
      randomModels: vi.fn(),
      historyPage: vi.fn(),
      historyInsights: vi.fn().mockResolvedValue({ total: 0, categories: [] }),
      storeManualModel: vi.fn(),
      updateHistoryItem: vi.fn(),
      deleteHistoryItem: vi.fn(),
      groupedModelsSummary: vi.fn(),
      getCatalogSnapshot: vi.fn(),
    };
  }

  it("forwards the filters and returns the aggregate", async () => {
    const app = Fastify();
    const service = stubService();
    service.historyInsights.mockResolvedValue({
      total: 2,
      categories: [{ categoryId: "9", categoryName: "GK", count: 2, latestCreatedAt: null }],
    });
    await gameRoutes(app, service as never);

    const response = await app.inject({
      method: "GET",
      url: "/games/history/insights?categoryId=9&difficultyPercentage=40&status=validated",
    });

    expect(response.statusCode).toBe(200);
    expect(service.historyInsights).toHaveBeenCalledWith({ categoryId: "9", difficultyPercentage: 40, status: "validated" });
    expect(response.json()).toEqual({
      gameType: "word-pass",
      total: 2,
      categories: [{ categoryId: "9", categoryName: "GK", count: 2, latestCreatedAt: null }],
    });
    await app.close();
  });

  it("rejects invalid filters and still serves the existing history route", async () => {
    const app = Fastify();
    const service = stubService();
    service.historyPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    await gameRoutes(app, service as never);

    const invalid = await app.inject({ method: "GET", url: "/games/history/insights?difficultyPercentage=500" });
    expect(invalid.statusCode).toBe(400);
    expect(service.historyInsights).not.toHaveBeenCalled();

    const history = await app.inject({ method: "GET", url: "/games/history" });
    expect(history.statusCode).toBe(200);
    expect(service.historyPage).toHaveBeenCalled();
    await app.close();
  });
});

describe("runtime worker difficulty distribution", () => {
  it("reads one GROUP BY and still yields one row per stored model", async () => {
    prismaMocks.count.mockResolvedValue(7);
    prismaMocks.groupBy.mockResolvedValue([
      { difficultyPercentage: 10, _count: { _all: 3 } },
      { difficultyPercentage: 50, _count: { _all: 2 } },
      { difficultyPercentage: 90, _count: { _all: 1 } },
      { difficultyPercentage: null, _count: { _all: 1 } },
    ]);
    const generationService = {
      getCatalogSnapshot: () => ({ categories: [{ id: "9", name: "GK" }] }),
      refreshCatalogs: vi.fn(),
      groupedModelsSummary: vi.fn().mockResolvedValue({ categories: [] }),
      runGenerationProcessBlocking: vi.fn(),
    };
    const worker = new RuntimeGenerationWorker(generationService as never);

    const snapshot = await worker.getSnapshot();

    expect(prismaMocks.groupBy).toHaveBeenCalledWith({
      by: ["difficultyPercentage"],
      where: { gameType: "word-pass" },
      _count: { _all: true },
    });
    // the unbounded findMany over the whole table is gone
    expect(prismaMocks.findMany).not.toHaveBeenCalled();
    expect(snapshot.balance.difficulties.map((item) => [item.id, item.total])).toEqual([
      ["easy", 3],
      ["medium", 2],
      ["hard", 1],
    ]);
  });
});

describe("health readiness", () => {
  it("keeps the legacy payload when no readiness source is given", async () => {
    const app = Fastify();
    await healthRoutes(app);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ status: "ok", service: "microservice-wordpass", gameType: "word-pass" });
    await app.close();
  });

  it("reports catalogReady honestly while still answering 200", async () => {
    const app = Fastify();
    let ready = false;
    await healthRoutes(app, {
      isCatalogReady: () => ready,
      getCatalogSnapshot: () => ({ source: ready ? "ai-engine" : "local-fallback" }),
    });

    const before = await app.inject({ method: "GET", url: "/health" });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ status: "ok", catalogReady: false, catalogSource: "local-fallback" });

    ready = true;
    const after = await app.inject({ method: "GET", url: "/health" });
    expect(after.json()).toMatchObject({ status: "ok", catalogReady: true, catalogSource: "ai-engine" });
    await app.close();
  });

  it("GenerationService only becomes ready once ai-engine catalogs were loaded", async () => {
    const service = new GenerationService(createConfig());
    expect(service.isCatalogReady()).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ categories: [{ id: "9", name: "GK" }] }), { status: 200 }))
    );
    await service.refreshCatalogs();
    vi.unstubAllGlobals();
    expect(service.isCatalogReady()).toBe(true);
  });
});

describe("listen-first startup", () => {
  function buildFakeServer() {
    const order: string[] = [];
    let resolveRefresh: (value: { source: string; categories: unknown[] }) => void = () => undefined;
    const refresh = new Promise<{ source: string; categories: unknown[] }>((resolve) => {
      resolveRefresh = resolve;
    });
    const app = {
      listen: vi.fn(async () => {
        order.push("listen");
      }),
      server: { listening: true },
      log: { info: vi.fn(), error: vi.fn() },
    };
    const server = {
      app,
      config: { SERVICE_NAME: "svc", SERVICE_PORT: 1 },
      gameType: "word-pass",
      generationService: {
        refreshCatalogs: vi.fn(() => {
          order.push("refresh-start");
          return refresh;
        }),
      },
      generationJob: {
        start: vi.fn(() => {
          order.push("job-start");
        }),
      },
      metrics: { recordLog: vi.fn() },
    };
    return { server, order, resolveRefresh, app };
  }

  it("binds the port before the catalog refresh finishes and starts the job afterwards", async () => {
    const { server, order, resolveRefresh } = buildFakeServer();

    const { background } = await startListeningFirst(server as never);

    // the call returned (server is listening) while the refresh is still pending
    expect(order).toEqual(["listen", "refresh-start"]);
    expect(server.generationJob.start).not.toHaveBeenCalled();

    resolveRefresh({ source: "ai-engine", categories: [{}, {}] });
    await background;

    expect(order).toEqual(["listen", "refresh-start", "job-start"]);
    expect(server.metrics.recordLog).toHaveBeenCalledWith("info", "catalogs_initialized", { source: "ai-engine", categories: 2 });
  });

  it("keeps serving and still starts the job when the refresh throws", async () => {
    const { server, app } = buildFakeServer();
    server.generationService.refreshCatalogs.mockRejectedValue(new Error("ai-engine down"));

    const { background } = await startListeningFirst(server as never);
    await background;

    expect(app.log.error).toHaveBeenCalledWith({ error: "ai-engine down" }, expect.stringContaining("Background catalog refresh failed"));
    expect(server.generationJob.start).toHaveBeenCalledTimes(1);
  });

  it("skips the job when the server was closed during the refresh and survives a job start failure", async () => {
    const closed = buildFakeServer();
    closed.app.server.listening = false;
    closed.resolveRefresh({ source: "local-fallback", categories: [] });
    await (await startListeningFirst(closed.server as never)).background;
    expect(closed.server.generationJob.start).not.toHaveBeenCalled();

    const failing = buildFakeServer();
    failing.server.generationJob.start.mockImplementation(() => {
      throw new Error("boom");
    });
    failing.resolveRefresh({ source: "ai-engine", categories: [] });
    await (await startListeningFirst(failing.server as never)).background;
    expect(failing.app.log.error).toHaveBeenCalledWith({ error: "boom" }, expect.stringContaining("Failed to start"));
  });

  it("reports non-Error rejections as plain strings", async () => {
    const refresh = buildFakeServer();
    refresh.server.generationService.refreshCatalogs.mockRejectedValue("plain failure");
    refresh.server.generationJob.start.mockImplementation(() => {
      throw "plain job failure";
    });
    await (await startListeningFirst(refresh.server as never)).background;
    expect(refresh.app.log.error).toHaveBeenCalledWith({ error: "plain failure" }, expect.any(String));
    expect(refresh.app.log.error).toHaveBeenCalledWith({ error: "plain job failure" }, expect.any(String));
  });

  it("propagates a listen failure to the caller", async () => {
    const { server, app } = buildFakeServer();
    app.listen.mockRejectedValue(new Error("EADDRINUSE"));
    await expect(startListeningFirst(server as never)).rejects.toThrow("EADDRINUSE");
    expect(server.generationService.refreshCatalogs).not.toHaveBeenCalled();
  });
});
