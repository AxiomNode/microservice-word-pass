import { FastifyInstance } from "fastify";
import { z } from "zod";
import { GenerationService } from "../services/generationService.js";
import {
  BaseGenerateSchema,
  IngestDocumentSchema,
  IngestSchema,
  RandomModelsQuerySchema,
  HistoryQuerySchema,
  GenerationProcessParamsSchema,
  GenerationProcessQuerySchema,
  GenerationProcessesListQuerySchema,
  ManualHistoryEntrySchema,
  HistoryItemParamsSchema,
} from "@axiomnode/shared-sdk-client";

const GenerateSchema = BaseGenerateSchema.extend({
  letters: z.string().optional(),
});

const GenerateProcessSchema = GenerateSchema.extend({
  count: z.number().int().min(1).max(100).default(10)
});

const GenerateProcessWaitSchema = GenerateProcessSchema;

export async function gameRoutes(
  app: FastifyInstance,
  generationService: GenerationService,
  onIngestedDocuments?: (total: number) => void
): Promise<void> {
  app.post("/games/generate", async (request, reply) => {
    const parsed = GenerateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten()
      });
    }

    try {
      generationService.assertAiGenerationAvailable();
      const result = await generationService.generateAndStore(parsed.data);
      return reply.status(201).send({
        gameType: "word-pass",
        generated: result
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const circuitOpen = /ai auth circuit open/i.test(message);
      return reply.status(circuitOpen ? 503 : 502).send({
        message: circuitOpen
          ? "Generation temporarily unavailable due to AI authentication failures"
          : "Failed to generate content from ai-engine",
        error: message
      });
    }
  });

  app.post("/games/generate/process", async (request, reply) => {
    const parsed = GenerateProcessSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten()
      });
    }

    try {
      generationService.assertAiGenerationAvailable();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return reply.status(503).send({
        message: "Generation temporarily unavailable due to AI authentication failures",
        error: message
      });
    }

    const task = generationService.startGenerationProcess(parsed.data);
    return reply.status(202).send({
      gameType: "word-pass",
      message: "Generation process started",
      task
    });
  });

  app.post("/games/generate/process/wait", async (request, reply) => {
    const parsed = GenerateProcessWaitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten()
      });
    }

    try {
      generationService.assertAiGenerationAvailable();
      const task = await generationService.runGenerationProcessBlocking(parsed.data);
      return reply.status(201).send({
        gameType: "word-pass",
        message: "Generation process completed",
        task
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const circuitOpen = /ai auth circuit open/i.test(message);
      return reply.status(circuitOpen ? 503 : 502).send({
        message: circuitOpen
          ? "Generation temporarily unavailable due to AI authentication failures"
          : "Failed to complete generation process",
        error: message
      });
    }
  });

  app.get("/games/generate/processes", async (request, reply) => {
    const parsed = GenerationProcessesListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsed.error.flatten(),
      });
    }

    const tasks = generationService.listGenerationProcesses(parsed.data);
    return reply.send({
      gameType: "word-pass",
      total: tasks.length,
      tasks
    });
  });

  app.get("/games/generate/process/:taskId", async (request, reply) => {
    const params = GenerationProcessParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        message: "Invalid path parameters",
        errors: params.error.flatten()
      });
    }

    const query = GenerationProcessQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: query.error.flatten()
      });
    }

    const task = generationService.getGenerationProcess(
      params.data.taskId,
      query.data.includeItems
    );

    if (!task) {
      return reply.status(404).send({
        message: "Generation process not found"
      });
    }

    return reply.send({
      gameType: "word-pass",
      task
    });
  });

  app.post("/games/ingest", async (request, reply) => {
    const parsed = IngestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten()
      });
    }

    try {
      const enrichedDocuments = parsed.data.documents.map((document) => ({
        ...document,
        metadata: {
          ...(document.metadata ?? {}),
          ...(parsed.data.categoryId ? { categoryId: parsed.data.categoryId } : {}),
          ...(parsed.data.language ? { language: parsed.data.language } : {}),
          ...(typeof parsed.data.difficultyPercentage === "number"
            ? { difficultyPercentage: parsed.data.difficultyPercentage }
            : {}),
        },
      }));

      const result = await generationService.ingestToRag(enrichedDocuments, parsed.data.source);
      onIngestedDocuments?.(result.ingested);
      return reply.status(202).send({
        gameType: "word-pass",
        ingested: result.ingested
      });
    } catch (error) {
      return reply.status(502).send({
        message: "Failed to ingest documents into ai-engine RAG",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/games/models/random", async (request, reply) => {
    const parsed = RandomModelsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsed.error.flatten()
      });
    }

    const items = await generationService.randomModels(parsed.data);
    return reply.send({
      gameType: "word-pass",
      requested: parsed.data.count,
      returned: items.length,
      items
    });
  });

  app.get("/games/history", async (request, reply) => {
    const parsed = HistoryQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsed.error.flatten(),
      });
    }

    const items = await generationService.history(parsed.data.limit, {
      categoryId: parsed.data.categoryId,
      language: parsed.data.language,
      difficultyPercentage: parsed.data.difficultyPercentage,
    });
    return reply.send({ gameType: "word-pass", items });
  });

  app.post("/games/history/manual", async (request, reply) => {
    const parsed = ManualHistoryEntrySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid payload",
        errors: parsed.error.flatten()
      });
    }

    try {
      const item = await generationService.storeManualModel(parsed.data);
      return reply.status(201).send({
        gameType: "word-pass",
        item
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const statusCode = /duplicate/i.test(message) ? 409 : 400;
      return reply.status(statusCode).send({
        message: "Failed to store manual model",
        error: message
      });
    }
  });

  app.delete("/games/history/:entryId", async (request, reply) => {
    const parsed = HistoryItemParamsSchema.safeParse(request.params ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid path parameters",
        errors: parsed.error.flatten()
      });
    }

    const deleted = await generationService.deleteHistoryItem(parsed.data.entryId);
    if (!deleted) {
      return reply.status(404).send({ message: "History entry not found" });
    }

    return reply.send({
      gameType: "word-pass",
      deleted: true,
      id: parsed.data.entryId
    });
  });

  app.get("/games/models/grouped", async (_request, reply) => {
    const summary = await generationService.groupedModelsSummary();
    return reply.send({
      gameType: "word-pass",
      groupedBy: ["category", "language"],
      ...summary
    });
  });

  app.get("/catalogs", async (_request, reply) => {
    return reply.send(generationService.getCatalogSnapshot());
  });
}
