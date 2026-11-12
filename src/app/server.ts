import "dotenv/config";

import { buildGameServer } from "@axiomnode/shared-sdk-client";

import { loadConfig } from "./config.js";
import { prisma } from "./db/client.js";
import { gameRoutes } from "./routes/games.js";
import { healthRoutes } from "./routes/health.js";
import { GenerationService } from "./services/generationService.js";
import { ModelGenerationJob } from "./services/modelGenerationJob.js";
import { RuntimeGenerationWorker } from "./services/runtimeGenerationWorker.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { ServiceMetrics } from "./services/serviceMetrics.js";
import { startListeningFirst } from "./services/startup.js";

/** @module server - Fastify application bootstrap, middleware setup, and main entrypoint. */

/** Builds and configures the Fastify server with all plugins, routes, and hooks. */
async function buildServer() {
  const config = loadConfig();
  const metrics = new ServiceMetrics(config);

  const generationService = new GenerationService(config, {
    onModelStored: () => metrics.recordGenerationStored(),
    onModelDuplicate: (reason) => metrics.recordGenerationDuplicate(reason),
    onModelFailed: () => metrics.recordGenerationFailed(),
    onAiAuthCircuitStateChanged: (state) => metrics.recordAiAuthCircuitState(state),
    onProcessStarted: ({ taskId, requested }) => metrics.recordGenerationProcessStarted(requested, taskId),
    onProcessItemProgress: (payload) => metrics.recordLog(
      payload.status === "failed" || payload.status === "timeout" ? "error" : "info",
      "generation_process_item_progress",
      payload
    ),
    onProcessCompleted: (snapshot) => metrics.recordGenerationProcessCompleted(snapshot),
    onBatchCompleted: (result) => metrics.recordBatch(result),
    onOutboundRequest: (metric) => metrics.recordOutboundRequest(metric)
  });
  const generationJob = new ModelGenerationJob(config, generationService);
  const runtimeGenerationWorker = new RuntimeGenerationWorker(generationService);
  return buildGameServer({
    config,
    generationService,
    generationJob,
    runtimeGenerationWorker,
    metrics,
    disconnect: () => prisma.$disconnect(),
    registerHealthRoutes: (app) => healthRoutes(app, generationService),
    registerGameRoutes: gameRoutes,
    registerMonitoringRoutes: monitoringRoutes,
  });
}

/** Starts the server, initializes catalogs, and launches the periodic generation job. */
async function main() {
  // Listen first; catalogs are refreshed in the background (with the same ai-engine retries) and /health
  // reports `catalogReady` honestly instead of blocking startup while ai-engine is unreachable.
  await startListeningFirst({
    ...(await buildServer()),
    gameType: "word-pass",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
