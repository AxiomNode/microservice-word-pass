import { FastifyInstance } from "fastify";
import { z } from "zod";
import { GenerationService } from "../services/generationService.js";

const GenerateSchema = z.object({
  categoryId: z.string().min(1),
  language: z.string().min(2).max(5),
  difficultyPercentage: z.number().int().min(0).max(100).optional(),
  numQuestions: z.number().int().min(1).max(50).optional(),
  letters: z.string().optional()
});

const GenerateProcessSchema = GenerateSchema.extend({
  count: z.number().int().min(1).max(100).default(10)
});

const IngestDocumentSchema = z.object({
  content: z.string().min(1),
  docId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional()
});

const IngestSchema = z.object({
  documents: z.array(IngestDocumentSchema).min(1),
  source: z.string().min(1).optional()
});

const RandomModelsQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(100).default(5),
  categoryId: z.string().min(1).optional(),
  language: z.string().min(2).max(5).optional(),
  status: z.string().min(1).optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional()
});

const GenerationProcessParamsSchema = z.object({
  taskId: z.string().uuid()
});

const GenerationProcessQuerySchema = z.object({
  includeItems: z.coerce.boolean().default(false)
});

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
      const result = await generationService.generateAndStore(parsed.data);
      return reply.status(201).send({
        gameType: "word-pass",
        generated: result
      });
    } catch (error) {
      return reply.status(502).send({
        message: "Failed to generate content from ai-engine",
        error: error instanceof Error ? error.message : "Unknown error"
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

    const task = generationService.startGenerationProcess(parsed.data);
    return reply.status(202).send({
      gameType: "word-pass",
      message: "Generation process started",
      task
    });
  });

  app.get("/games/generate/processes", async (request, reply) => {
    const limitRaw = (request.query as { limit?: string } | undefined)?.limit;
    const limit = limitRaw ? Number(limitRaw) : 20;
    const tasks = generationService.listGenerationProcesses(Number.isNaN(limit) ? 20 : limit);
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
      const result = await generationService.ingestToRag(parsed.data.documents, parsed.data.source);
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
    const limitRaw = (request.query as { limit?: string } | undefined)?.limit;
    const limit = limitRaw ? Number(limitRaw) : 20;
    const items = await generationService.history(Number.isNaN(limit) ? 20 : limit);
    return reply.send({ gameType: "word-pass", items });
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
