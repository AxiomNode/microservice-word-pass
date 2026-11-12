/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Equivalence checks against a real PostgreSQL: the new aggregate / id-sampling queries must return the same data as
 * the previous "load everything and compute in JS" approach.
 *
 * Opt-in: set TEST_DATABASE_URL to a THROWAWAY database whose schema was applied with `prisma db push`, e.g.
 *   docker run -d --name pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:pw@localhost:55432/postgres npx prisma db push
 *   TEST_DATABASE_URL=postgresql://postgres:pw@localhost:55432/postgres npx vitest run tests/phase2Queries.postgres.test.ts
 * The suite wipes the GameGeneration table, so never point it at a real database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const GAME_TYPE = "word-pass";

const QUESTION = (n: number) => ({
  game_type: "word-pass",
  game: { words: [{ letter: "A", hint: `Hint ${n}`, answer: "Atomo", starts_with: true }] },
});

describe.skipIf(!databaseUrl)("phase 2 query equivalence (PostgreSQL)", () => {
  let prisma: any;
  let service: any;
  let RuntimeGenerationWorker: any;
  let allRows: any[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ prisma } = await import("../app/db/client.js"));
    const { GenerationService } = await import("../app/services/generationService.js");
    ({ RuntimeGenerationWorker } = await import("../app/services/runtimeGenerationWorker.js"));
    service = new GenerationService({
      SERVICE_NAME: "microservice-wordpass",
      AI_ENGINE_BASE_URL: "http://localhost:1",
      AI_ENGINE_REQUEST_TIMEOUT_MS: 100,
      AI_ENGINE_RETRY_MAX_ATTEMPTS: 1,
      AI_AUTH_CIRCUIT_FAILURE_THRESHOLD: 3,
      AI_AUTH_CIRCUIT_COOLDOWN_MS: 1000,
    } as any);

    await prisma.gameGeneration.deleteMany({});

    // Deterministic dataset: 3 categories (one id in two letter cases, one with a null name), 2 statuses,
    // difficulties spread over all three buckets plus nulls, strictly increasing createdAt.
    const categories = [
      { id: "9", name: "General Knowledge" },
      { id: "17", name: "Science" },
      { id: "17", name: "Science" },
      { id: "Hist", name: "History" },
      { id: "hist", name: "History" },
      { id: null, name: null },
    ];
    const difficulties = [0, 10, 33, 34, 50, 66, 67, 90, 100, null];
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const data = Array.from({ length: 240 }, (_, index) => {
      const category = categories[index % categories.length]!;
      return {
        gameType: GAME_TYPE,
        query: `query ${index}`,
        status: index % 5 === 0 ? "validated" : "created",
        categoryId: category.id,
        categoryName: category.name,
        difficultyPercentage: difficulties[index % difficulties.length],
        uniquenessKey: `key-${index}`,
        requestJson: JSON.stringify({ n: index, padding: "x".repeat(200) }),
        responseJson: JSON.stringify(QUESTION(index)),
        createdAt: new Date(base + index * 60_000),
      };
    });
    // a different game type must never leak into the word-pass aggregates
    data.push({ ...data[0]!, gameType: "quiz", uniquenessKey: "other-0" });
    await prisma.gameGeneration.createMany({ data });
    allRows = await prisma.gameGeneration.findMany({ where: { gameType: GAME_TYPE }, orderBy: { createdAt: "desc" } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** The previous BFF logic, reduced to counting rows per lower-cased category id. */
  function legacyCategoryCounts(rows: any[]) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = String(row.categoryId ?? "unknown").toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  function aggregateCategoryCounts(result: { categories: Array<{ categoryId: string | null; count: number }> }) {
    const counts = new Map<string, number>();
    for (const item of result.categories) {
      const key = String(item.categoryId ?? "unknown").toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + item.count);
    }
    return counts;
  }

  it.each([
    ["no filters", undefined, () => true],
    ["status", { status: "validated" }, (row: any) => row.status === "validated"],
    ["category", { categoryId: "9" }, (row: any) => row.categoryId === "9"],
    ["difficulty", { difficultyPercentage: 50 }, (row: any) => row.difficultyPercentage === 50],
    [
      "category + difficulty + status",
      { categoryId: "17", difficultyPercentage: 90, status: "created" },
      (row: any) => row.categoryId === "17" && row.difficultyPercentage === 90 && row.status === "created",
    ],
  ])("historyInsights equals counting every history row (%s)", async (_label, filters, predicate) => {
    const expectedRows = allRows.filter(predicate);

    const insights = await service.historyInsights(filters);

    expect(insights.total).toBe(expectedRows.length);
    expect(aggregateCategoryCounts(insights)).toEqual(legacyCategoryCounts(expectedRows));
    // historyPage reports the same total for the same filters
    const page = await service.historyPage(20, { ...filters, page: 1, pageSize: 1 });
    expect(page.total).toBe(insights.total);
    // latestCreatedAt is the newest row of the bucket
    for (const bucket of insights.categories) {
      const newest = expectedRows.find((row) => row.categoryId === bucket.categoryId && row.categoryName === bucket.categoryName);
      expect(bucket.latestCreatedAt).toBe(newest?.createdAt.toISOString());
    }
  });

  it("the worker difficulty distribution equals the previous full-table scan", async () => {
    const legacyRows = await prisma.gameGeneration.findMany({ where: { gameType: GAME_TYPE }, select: { difficultyPercentage: true } });
    const legacyCounts = { easy: 0, medium: 0, hard: 0 };
    for (const row of legacyRows) {
      const value = row.difficultyPercentage;
      if (typeof value !== "number") continue;
      legacyCounts[value <= 33 ? "easy" : value <= 66 ? "medium" : "hard"] += 1;
    }

    const worker = new RuntimeGenerationWorker({
      getCatalogSnapshot: () => ({ categories: [{ id: "9", name: "GK" }] }),
      refreshCatalogs: async () => ({ categories: [] }),
      groupedModelsSummary: async () => ({ categories: [] }),
      runGenerationProcessBlocking: async () => ({}),
    });
    const snapshot = await worker.getSnapshot();

    expect(snapshot.totalObjectsInDb).toBe(legacyRows.length);
    expect(Object.fromEntries(snapshot.balance.difficulties.map((item: any) => [item.id, item.total]))).toEqual(legacyCounts);
  });

  it("randomModels returns exactly the legacy full-pool rows when the pool is not larger than count", async () => {
    // pool = min(1000, max(count * 30, 300)); with a filter that leaves < count rows the random pick is the whole set
    const filters = { count: 100, categoryId: "9", difficultyPercentage: 50, status: "created" };
    const expected = await prisma.gameGeneration.findMany({
      where: { gameType: GAME_TYPE, categoryId: "9", difficultyPercentage: 50, status: "created" },
      orderBy: { createdAt: "desc" },
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(filters.count);

    const result = await service.randomModels(filters);

    expect(result.map((item: any) => item.id).sort()).toEqual(expected.map((row: any) => row.id).sort());
    const sample = result[0];
    const source = expected.find((row: any) => row.id === sample.id);
    expect(sample).toMatchObject({
      gameType: GAME_TYPE,
      query: source.query,
      status: source.status,
      categoryId: source.categoryId,
      categoryName: source.categoryName,
      request: JSON.parse(source.requestJson),
    });
  });

  it("randomModels honours count, excludes pending_review by default and never leaves the filtered pool", async () => {
    await prisma.gameGeneration.create({
      data: {
        gameType: GAME_TYPE,
        query: "pending",
        status: "pending_review",
        categoryId: "9",
        difficultyPercentage: 50,
        uniquenessKey: "pending-0",
        requestJson: "{}",
        responseJson: JSON.stringify(QUESTION(9999)),
      },
    });

    const result = await service.randomModels({ count: 7, categoryId: "17" });
    expect(result).toHaveLength(7);
    expect(new Set(result.map((item: any) => item.id)).size).toBe(7);
    expect(result.every((item: any) => item.categoryId === "17" && item.status !== "pending_review")).toBe(true);

    const everything = await service.randomModels({ count: 100 });
    expect(everything.some((item: any) => item.query === "pending")).toBe(false);

    // different calls explore different rows (the pool is 240 rows, picking 7 twice rarely matches)
    const first = (await service.randomModels({ count: 7 })).map((item: any) => item.id).join();
    const second = (await service.randomModels({ count: 7 })).map((item: any) => item.id).join();
    const third = (await service.randomModels({ count: 7 })).map((item: any) => item.id).join();
    expect(new Set([first, second, third]).size).toBeGreaterThan(1);
  });
});
