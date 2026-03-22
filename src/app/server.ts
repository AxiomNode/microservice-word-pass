import "dotenv/config";

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import Fastify from "fastify";

import { loadConfig } from "./config.js";
import { prisma } from "./db/client.js";
import { registerPrivateDocs } from "./plugins/privateDocs.js";
import { gameRoutes } from "./routes/games.js";
import { healthRoutes } from "./routes/health.js";
import { GenerationService } from "./services/generationService.js";
import { ModelGenerationJob } from "./services/modelGenerationJob.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { ServiceMetrics } from "./services/serviceMetrics.js";

async function buildServer() {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const metrics = new ServiceMetrics(config);

  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      info: {
        title: `${config.SERVICE_NAME} API`,
        version: "0.1.0"
      }
    }
  });

  await registerPrivateDocs(app, config);

  const generationService = new GenerationService(config, {
    onModelStored: () => metrics.recordGenerationStored(),
    onModelDuplicate: (reason) => metrics.recordGenerationDuplicate(reason),
    onModelFailed: () => metrics.recordGenerationFailed(),
    onProcessStarted: ({ requested }) => metrics.recordGenerationProcessStarted(requested),
    onProcessCompleted: (snapshot) => metrics.recordGenerationProcessCompleted(snapshot),
    onBatchCompleted: (result) => metrics.recordBatch(result),
    onOutboundRequest: (metric) => metrics.recordOutboundRequest(metric)
  });
  const generationJob = new ModelGenerationJob(config, generationService);

  app.addHook("onRequest", async (request) => {
    const requestAny = request as typeof request & {
      _startedAt?: number;
      _requestBytes?: number;
    };
    requestAny._startedAt = Date.now();

    const contentLength = Number(request.headers["content-length"] ?? 0);
    requestAny._requestBytes = Number.isFinite(contentLength) ? contentLength : 0;
  });

  app.addHook("onResponse", async (request, reply) => {
    const requestAny = request as typeof request & {
      _startedAt?: number;
      _requestBytes?: number;
    };

    const responseContentLength = Number(reply.getHeader("content-length") ?? 0);
    const responseBytes = Number.isFinite(responseContentLength) ? responseContentLength : 0;
    const route = (request.routeOptions.url ?? request.url.split("?")[0]) as string;

    metrics.recordIncomingRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs: Math.max(0, Date.now() - (requestAny._startedAt ?? Date.now())),
      requestBytes: requestAny._requestBytes ?? 0,
      responseBytes
    });
  });

  await healthRoutes(app);
  await gameRoutes(app, generationService, (total) => metrics.recordIngestedDocuments(total));
  await monitoringRoutes(app, metrics, generationService);

  app.addHook("onClose", async () => {
    generationJob.stop();
    await prisma.$disconnect();
  });

  return { app, config, generationJob, generationService, metrics };
}

async function main() {
  const { app, config, generationJob, generationService, metrics } = await buildServer();

  const catalogs = await generationService.refreshCatalogs();
  metrics.recordLog("info", "catalogs_initialized", {
    source: catalogs.source,
    categories: catalogs.categories.length,
    languages: catalogs.languages.length
  });

  await app.listen({ host: "0.0.0.0", port: config.SERVICE_PORT });
  generationJob.start(app.log);
  app.log.info(
    { service: config.SERVICE_NAME, gameType: "word-pass" },
    "Service started"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
