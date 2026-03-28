import "dotenv/config";

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";

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
    onAiAuthCircuitStateChanged: (state) => metrics.recordAiAuthCircuitState(state),
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
      _correlationId?: string;
    };
    requestAny._startedAt = Date.now();

    const contentLength = Number(request.headers["content-length"] ?? 0);
    requestAny._requestBytes = Number.isFinite(contentLength) ? contentLength : 0;

    const inboundCorrelationId = String(request.headers["x-correlation-id"] ?? "").trim();
    requestAny._correlationId = inboundCorrelationId || randomUUID();
    request.headers["x-correlation-id"] = requestAny._correlationId;
  });

  app.addHook("onResponse", async (request, reply) => {
    const requestAny = request as typeof request & {
      _startedAt?: number;
      _requestBytes?: number;
      _correlationId?: string;
    };

    const responseContentLength = Number(reply.getHeader("content-length") ?? 0);
    const responseBytes = Number.isFinite(responseContentLength) ? responseContentLength : 0;
    const route = (request.routeOptions.url ?? request.url.split("?")[0]) as string;
    const correlationId = requestAny._correlationId ?? randomUUID();
    const durationMs = Math.max(0, Date.now() - (requestAny._startedAt ?? Date.now()));

    reply.header("x-correlation-id", correlationId);

    metrics.recordIncomingRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs,
      requestBytes: requestAny._requestBytes ?? 0,
      responseBytes
    });

    app.log.info({
      correlation_id: correlationId,
      service: config.SERVICE_NAME,
      route,
      status_code: reply.statusCode,
      duration_ms: durationMs,
      error_code: reply.statusCode >= 500 ? "upstream_or_internal_error" : undefined
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
