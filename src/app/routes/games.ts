import { FastifyInstance } from "fastify";
import { z } from "zod";
import { GenerationService } from "../services/generationService.js";
import {
  RuntimeGenerationWorker,
} from "../services/runtimeGenerationWorker.js";
import {
  BaseGenerateSchema,
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
