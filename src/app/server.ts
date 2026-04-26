import "dotenv/config";

import { buildGameServer, startGameServer } from "@axiomnode/shared-sdk-client";

import { loadConfig } from "./config.js";
import { prisma } from "./db/client.js";
import { gameRoutes } from "./routes/games.js";
import { healthRoutes } from "./routes/health.js";
import { GenerationService } from "./services/generationService.js";
import { ModelGenerationJob } from "./services/modelGenerationJob.js";
import { RuntimeGenerationWorker } from "./services/runtimeGenerationWorker.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { ServiceMetrics } from "./services/serviceMetrics.js";

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
    onProcessStarted: ({ requested }) => metrics.recordGenerationProcessStarted(requested),
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
    registerHealthRoutes: healthRoutes,
    registerGameRoutes: gameRoutes,
    registerMonitoringRoutes: monitoringRoutes,
  });
}

/** Starts the server, initializes catalogs, and launches the periodic generation job. */
async function main() {
  await startGameServer({
    ...(await buildServer()),
    gameType: "word-pass",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
