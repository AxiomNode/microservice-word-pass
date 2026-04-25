import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ServiceMetrics } from "../services/serviceMetrics.js";
import { GenerationService } from "../services/generationService.js";

/** @module monitoring - Observability routes: stats snapshot, recent logs, and Prometheus metrics. */

const LogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(200)
});

/** Registers monitoring endpoints: /monitor/stats, /monitor/logs, and /metrics. */
export async function monitoringRoutes(
  app: FastifyInstance,
  metrics: ServiceMetrics,
  generationService: GenerationService
): Promise<void> {
  app.get("/monitor/stats", async (_request, reply) => {
    const stats = metrics.snapshot();
    const catalogs = generationService.getCatalogSnapshot();
    const grouped = await generationService.groupedModelsSummary();

    const totalCategories = catalogs.categories.length;
    const categoriesWithData = grouped.categories.filter((item) => item.total > 0).length;
    const matrixSlotsWithData = grouped.matrix.length;

    return reply.send({
      ...stats,
      coverage: {
        catalogSource: catalogs.source,
        totalCategories,
        categoriesWithData,
        categoryCoverageRatio: totalCategories > 0 ? categoriesWithData / totalCategories : 0,
        matrixSlotsWithData,
        categoryCoverageRatioFromMatrix: totalCategories > 0 ? matrixSlotsWithData / totalCategories : 0
      }
    });
  });

  app.get("/monitor/logs", async (request, reply) => {
    /* v8 ignore next -- Fastify always materializes request.query for matched routes; the nullish fallback is defensive only */
    const parsed = LogsQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid query parameters",
        errors: parsed.error.flatten()
      });
    }

    const logs = metrics.recentLogs(parsed.data.limit);

    return reply.send({
      service: "microservice-wordpass",
      total: logs.length,
      logs
    });
  });

  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return reply.send(metrics.toPrometheus());
  });
}
