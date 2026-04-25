import { describe, expect, it, vi } from "vitest";

import Fastify from "fastify";

import { gameRoutes } from "../app/routes/games.js";

function createGenerationServiceStub() {
  return {
    assertAiGenerationAvailable: vi.fn(),
    generateAndStore: vi.fn(),
    startGenerationProcess: vi.fn(),
    runGenerationProcessBlocking: vi.fn(),
    listGenerationProcesses: vi.fn().mockReturnValue([]),
    getGenerationProcess: vi.fn(),
    ingestToRag: vi.fn(),
    randomModels: vi.fn().mockResolvedValue([]),
    history: vi.fn(),
    historyPage: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    storeManualModel: vi.fn(),
    updateHistoryItem: vi.fn(),
    deleteHistoryItem: vi.fn(),
    groupedModelsSummary: vi.fn(),
    getCatalogSnapshot: vi.fn(),
  };
}

describe("games routes", () => {
  it("rejects invalid generate payloads before hitting the generation service", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();

    await gameRoutes(app, generationService as never);

    const response = await app.inject({
      method: "POST",
      url: "/games/generate",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: "Invalid payload" });
    expect(generationService.assertAiGenerationAvailable).not.toHaveBeenCalled();
    expect(generationService.generateAndStore).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects invalid random-model query params before hitting the generation service", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();

    await gameRoutes(app, generationService as never);

    const response = await app.inject({
      method: "GET",
      url: "/games/models/random?count=0",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: "Invalid query parameters" });
    expect(generationService.randomModels).not.toHaveBeenCalled();

    await app.close();
  });

  it("accepts itemCount on generate payloads and forwards it to the generation service", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();
    generationService.generateAndStore.mockResolvedValue({ id: "wordpass-1" });

    await gameRoutes(app, generationService as never);

    const response = await app.inject({
      method: "POST",
      url: "/games/generate",
      payload: {
        categoryId: "11",
        difficultyPercentage: 55,
        itemCount: 5,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(generationService.generateAndStore).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: "11",
        difficultyPercentage: 55,
        itemCount: 5,
      }),
    );

    await app.close();
  });

  it("updates word-pass history entries through patch route", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();
    generationService.updateHistoryItem.mockResolvedValue({ id: "entry-3", status: "pending_review" });

    await gameRoutes(app, generationService as never);

    const response = await app.inject({
      method: "PATCH",
      url: "/games/history/entry-3",
      payload: {
        status: "pending_review",
        content: { words: [{ answer: "Nueva" }] },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(generationService.updateHistoryItem).toHaveBeenCalledWith(
      "entry-3",
      expect.objectContaining({
        status: "pending_review",
      }),
    );

    await app.close();
  });

  it("forwards paginated history query params to historyPage", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();

    await gameRoutes(app, generationService as never);

    const response = await app.inject({
      method: "GET",
      url: "/games/history?limit=400&page=2&pageSize=30&status=validated",
    });

    expect(response.statusCode).toBe(200);
    expect(generationService.historyPage).toHaveBeenCalledWith(400, {
      page: 2,
      pageSize: 30,
      categoryId: undefined,
      difficultyPercentage: undefined,
      status: "validated",
    });

    await app.close();
  });

  it("maps generate failures to 502 or 503 depending on AI auth circuit state", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();
    generationService.generateAndStore
      .mockRejectedValueOnce(new Error("ai auth circuit open after repeated 401"))
      .mockRejectedValueOnce(new Error("upstream timeout"));

    await gameRoutes(app, generationService as never);

    const circuitOpen = await app.inject({
      method: "POST",
      url: "/games/generate",
      payload: { categoryId: "9" },
    });
    const upstreamFailure = await app.inject({
      method: "POST",
      url: "/games/generate",
      payload: { categoryId: "9" },
    });

    expect(circuitOpen.statusCode).toBe(503);
    expect(upstreamFailure.statusCode).toBe(502);

    await app.close();
  });

  it("covers async generation process start, wait, list and detail routes", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();
    generationService.startGenerationProcess.mockReturnValue({ taskId: "550e8400-e29b-41d4-a716-446655440000", status: "running" });
    generationService.runGenerationProcessBlocking
      .mockResolvedValueOnce({ taskId: "550e8400-e29b-41d4-a716-446655440001", status: "completed" })
      .mockRejectedValueOnce(new Error("ai auth circuit open"))
      .mockRejectedValueOnce(new Error("upstream failure"));
    generationService.listGenerationProcesses.mockReturnValue([{ taskId: "550e8400-e29b-41d4-a716-446655440000" }]);
    generationService.getGenerationProcess
      .mockReturnValueOnce({ taskId: "550e8400-e29b-41d4-a716-446655440000", generatedItems: [{ id: "wp1" }] })
      .mockReturnValueOnce(undefined);

    await gameRoutes(app, generationService as never);

    const invalidStart = await app.inject({
      method: "POST",
      url: "/games/generate/process",
      payload: {},
    });
    generationService.assertAiGenerationAvailable.mockImplementationOnce(() => {
      throw new Error("ai auth circuit open");
    });
    const unavailableStart = await app.inject({
      method: "POST",
      url: "/games/generate/process",
      payload: { categoryId: "9", count: 4 },
    });
    const started = await app.inject({
      method: "POST",
      url: "/games/generate/process",
      payload: { categoryId: "9", count: 4 },
    });
    const completed = await app.inject({
      method: "POST",
      url: "/games/generate/process/wait",
      payload: { categoryId: "9", count: 3 },
    });
    const circuitWait = await app.inject({
      method: "POST",
      url: "/games/generate/process/wait",
      payload: { categoryId: "9", count: 3 },
    });
    const failedWait = await app.inject({
      method: "POST",
      url: "/games/generate/process/wait",
      payload: { categoryId: "9", count: 3 },
    });
    const invalidList = await app.inject({
      method: "GET",
      url: "/games/generate/processes?limit=0",
    });
    const listed = await app.inject({
      method: "GET",
      url: "/games/generate/processes?limit=5&status=completed&requestedBy=backoffice",
    });
    const invalidParams = await app.inject({
      method: "GET",
      url: "/games/generate/process/not-a-uuid",
    });
    const detailed = await app.inject({
      method: "GET",
      url: "/games/generate/process/550e8400-e29b-41d4-a716-446655440000?includeItems=true",
    });
    const missing = await app.inject({
      method: "GET",
      url: "/games/generate/process/550e8400-e29b-41d4-a716-446655440002",
    });

    expect(invalidStart.statusCode).toBe(400);
    expect(unavailableStart.statusCode).toBe(503);
    expect(started.statusCode).toBe(202);
    expect(completed.statusCode).toBe(201);
    expect(circuitWait.statusCode).toBe(503);
    expect(failedWait.statusCode).toBe(502);
    expect(invalidList.statusCode).toBe(400);
    expect(listed.statusCode).toBe(200);
    expect(generationService.listGenerationProcesses).toHaveBeenCalledWith({
      limit: 5,
      status: "completed",
      requestedBy: "backoffice",
    });
    expect(invalidParams.statusCode).toBe(400);
    expect(detailed.statusCode).toBe(200);
    expect(generationService.getGenerationProcess).toHaveBeenNthCalledWith(1, "550e8400-e29b-41d4-a716-446655440000", true);
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it("ingests documents with enriched metadata and handles ingest failures", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();
    const onIngestedDocuments = vi.fn();
    generationService.ingestToRag
      .mockResolvedValueOnce({ ingested: 2 })
      .mockRejectedValueOnce(new Error("rag unavailable"));

    await gameRoutes(app, generationService as never, onIngestedDocuments);

    const invalidPayload = await app.inject({
      method: "POST",
      url: "/games/ingest",
      payload: { documents: [] },
    });
    const success = await app.inject({
      method: "POST",
      url: "/games/ingest",
      payload: {
        documents: [{ content: "Wordpass content", metadata: { origin: "seed" } }],
        source: "backoffice",
        categoryId: "9",
        difficultyPercentage: 60,
      },
    });
    const failure = await app.inject({
      method: "POST",
      url: "/games/ingest",
      payload: {
        documents: [{ content: "Wordpass content" }],
        source: "backoffice",
      },
    });

    expect(invalidPayload.statusCode).toBe(400);
    expect(success.statusCode).toBe(202);
    expect(generationService.ingestToRag).toHaveBeenNthCalledWith(
      1,
      [
        {
          content: "Wordpass content",
          metadata: { origin: "seed", categoryId: "9", difficultyPercentage: 60 },
        },
      ],
      "backoffice",
    );
    expect(onIngestedDocuments).toHaveBeenCalledWith(2);
    expect(failure.statusCode).toBe(502);

    await app.close();
  });

  it("covers random models, manual history, delete, grouped models and catalogs routes", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();
    generationService.randomModels.mockResolvedValue([{ id: "wordpass-1" }]);
    generationService.storeManualModel
      .mockResolvedValueOnce({ id: "manual-1" })
      .mockRejectedValueOnce(new Error("duplicate key"))
      .mockRejectedValueOnce(new Error("invalid content"));
    generationService.deleteHistoryItem
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    generationService.groupedModelsSummary.mockResolvedValue({ categories: [{ name: "General", total: 1 }], matrix: [{ categoryId: "9", total: 1 }] });
    generationService.getCatalogSnapshot.mockReturnValue({ source: "seed", categories: [{ id: "9" }] });

    await gameRoutes(app, generationService as never);

    const random = await app.inject({
      method: "GET",
      url: "/games/models/random?count=2",
    });
    const invalidManual = await app.inject({
      method: "POST",
      url: "/games/history/manual",
      payload: {},
    });
    const manual = await app.inject({
      method: "POST",
      url: "/games/history/manual",
      payload: { categoryId: "9", difficultyPercentage: 40, content: { words: [{ answer: "Q" }] } },
    });
    const duplicateManual = await app.inject({
      method: "POST",
      url: "/games/history/manual",
      payload: { categoryId: "9", difficultyPercentage: 40, content: { words: [{ answer: "Q" }] } },
    });
    const invalidManualError = await app.inject({
      method: "POST",
      url: "/games/history/manual",
      payload: { categoryId: "9", difficultyPercentage: 40, content: { words: [{ answer: "Q" }] } },
    });
    const invalidDelete = await app.inject({
      method: "DELETE",
      url: "/games/history/",
    });
    const missingDelete = await app.inject({
      method: "DELETE",
      url: "/games/history/entry-404",
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: "/games/history/entry-2",
    });
    const grouped = await app.inject({ method: "GET", url: "/games/models/grouped" });
    const catalogs = await app.inject({ method: "GET", url: "/catalogs" });

    expect(random.statusCode).toBe(200);
    expect(random.json()).toMatchObject({ requested: 2, returned: 1 });
    expect(invalidManual.statusCode).toBe(400);
    expect(manual.statusCode).toBe(201);
    expect(duplicateManual.statusCode).toBe(409);
    expect(invalidManualError.statusCode).toBe(400);
    expect(invalidDelete.statusCode).toBe(400);
    expect(missingDelete.statusCode).toBe(404);
    expect(deleted.statusCode).toBe(200);
    expect(grouped.statusCode).toBe(200);
    expect(catalogs.statusCode).toBe(200);

    await app.close();
  });

  it("covers patch-history validation, not found, duplicate conflict and generic failure", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();
    generationService.updateHistoryItem
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("duplicate entry"))
      .mockRejectedValueOnce(new Error("invalid update"));

    await gameRoutes(app, generationService as never);

    const invalidParams = await app.inject({
      method: "PATCH",
      url: "/games/history/",
      payload: { status: "manual" },
    });
    const invalidPayload = await app.inject({
      method: "PATCH",
      url: "/games/history/entry-1",
      payload: {},
    });
    const missing = await app.inject({
      method: "PATCH",
      url: "/games/history/entry-1",
      payload: { status: "manual" },
    });
    const duplicate = await app.inject({
      method: "PATCH",
      url: "/games/history/entry-1",
      payload: { status: "manual" },
    });
    const generic = await app.inject({
      method: "PATCH",
      url: "/games/history/entry-1",
      payload: { status: "manual" },
    });

    expect(invalidParams.statusCode).toBe(400);
    expect(invalidPayload.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    expect(duplicate.statusCode).toBe(409);
    expect(generic.statusCode).toBe(400);

    await app.close();
  });

  it("covers remaining invalid-query and non-Error branches across routes", async () => {
    const app = Fastify();
    const generationService = createGenerationServiceStub();
    generationService.generateAndStore.mockRejectedValueOnce("boom");
    generationService.assertAiGenerationAvailable.mockImplementation(() => undefined);
    generationService.runGenerationProcessBlocking.mockRejectedValueOnce("boom");
    generationService.getGenerationProcess.mockReturnValue(undefined);
    generationService.ingestToRag.mockRejectedValueOnce("boom");
    generationService.storeManualModel.mockRejectedValueOnce("boom");
    generationService.updateHistoryItem.mockRejectedValueOnce("boom");

    await gameRoutes(app, generationService as never);

    const generateUnknown = await app.inject({
      method: "POST",
      url: "/games/generate",
      payload: { categoryId: "9" },
    });
    generationService.assertAiGenerationAvailable.mockImplementationOnce(() => {
      throw "boom";
    });
    const processStartUnknown = await app.inject({
      method: "POST",
      url: "/games/generate/process",
      payload: { categoryId: "9", count: 2 },
    });
    const invalidWaitPayload = await app.inject({
      method: "POST",
      url: "/games/generate/process/wait",
      payload: {},
    });
    const waitUnknown = await app.inject({
      method: "POST",
      url: "/games/generate/process/wait",
      payload: { categoryId: "9", count: 2 },
    });
    const invalidProcessQuery = await app.inject({
      method: "GET",
      url: "/games/generate/process/550e8400-e29b-41d4-a716-446655440000?includeItems=maybe",
    });
    const historyInvalid = await app.inject({
      method: "GET",
      url: "/games/history?page=0",
    });
    const ingestUnknown = await app.inject({
      method: "POST",
      url: "/games/ingest",
      payload: { documents: [{ content: "A" }] },
    });
    const manualUnknown = await app.inject({
      method: "POST",
      url: "/games/history/manual",
      payload: { categoryId: "9", difficultyPercentage: 40, content: { words: [{ answer: "Q" }] } },
    });
    const patchUnknown = await app.inject({
      method: "PATCH",
      url: "/games/history/entry-1",
      payload: { status: "manual" },
    });

    expect(generateUnknown.statusCode).toBe(502);
    expect(generateUnknown.json()).toMatchObject({ error: "Unknown error" });
    expect(processStartUnknown.statusCode).toBe(503);
    expect(processStartUnknown.json()).toMatchObject({ error: "Unknown error" });
    expect(invalidWaitPayload.statusCode).toBe(400);
    expect(waitUnknown.statusCode).toBe(502);
    expect(waitUnknown.json()).toMatchObject({ error: "Unknown error" });
    expect(invalidProcessQuery.statusCode).toBe(404);
    expect(historyInvalid.statusCode).toBe(400);
    expect(ingestUnknown.statusCode).toBe(502);
    expect(ingestUnknown.json()).toMatchObject({ error: "Unknown error" });
    expect(manualUnknown.statusCode).toBe(400);
    expect(manualUnknown.json()).toMatchObject({ error: "Unknown error" });
    expect(patchUnknown.statusCode).toBe(400);
    expect(patchUnknown.json()).toMatchObject({ error: "Unknown error" });

    await app.close();
  });
});
