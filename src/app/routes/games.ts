import { FastifyInstance } from "fastify";
import { z } from "zod";
import { GenerationService } from "../services/generationService.js";
import {
  RuntimeGenerationWorker,
} from "../services/runtimeGenerationWorker.js";
import {
  BaseGenerateSchema,
  HistoryQuerySchema,
  createGameRoutes as createSharedGameRoutes,
} from "@axiomnode/shared-sdk-client";

/** @module games - CRUD and generation routes for word-pass game models. */

const GenerateSchema = BaseGenerateSchema.extend({
  letters: z.string().optional(),
});

/** Registers all /games/* routes: generate, ingest, random, history, catalogs, and processes. */
export async function gameRoutes(
  app: FastifyInstance,
  generationService: GenerationService,
  onIngestedDocuments?: (total: number) => void,
  runtimeGenerationWorker?: RuntimeGenerationWorker
): Promise<void> {
  const InsightsQuerySchema = HistoryQuerySchema.pick({ categoryId: true, difficultyPercentage: true, status: true });

  /** Aggregate behind the Backoffice history insights: GROUP BY category, no row payloads. */
  app.get("/games/history/insights", async (request, reply) => {
    const parsed = InsightsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsed.error.flatten(),
      });
    }

    const insights = await generationService.historyInsights(parsed.data);
    return reply.send({ gameType: "word-pass", ...insights });
  });

  return createSharedGameRoutes({
    app,
    gameType: "word-pass",
    generateSchema: GenerateSchema,
    groupedBy: ["category", "language"],
    generationService,
    onIngestedDocuments,
    runtimeGenerationWorker,
  });
}
