import type { FastifyBaseLogger, FastifyInstance } from "fastify";

/** @module startup - Listen-first startup: the HTTP server binds before ai-engine catalogs are refreshed. */

/** Minimal shape of the built game server that the startup sequence needs. */
export interface StartableGameServer {
  app: FastifyInstance;
  config: { SERVICE_NAME: string; SERVICE_PORT: number };
  gameType: string;
  generationService: {
    refreshCatalogs(): Promise<{ source: string; categories: unknown[] }>;
  };
  generationJob: { start(logger: FastifyBaseLogger): unknown };
  metrics: { recordLog(level: "info" | "warn" | "error", message: string, payload?: Record<string, unknown>): unknown };
}

/**
 * Binds the HTTP port first, then refreshes the catalogs in the background and starts the periodic job once the
 * refresh attempt (including its ai-engine retries) has finished. Liveness is available immediately; readiness is
 * reported by `catalogReady` on /health.
 *
 * @returns `background`, a promise that settles when the catalog refresh and job start are done (never rejects).
 *   It is wrapped in an object because returning a bare promise from an async function would wait for it.
 */
export async function startListeningFirst(server: StartableGameServer): Promise<{ background: Promise<void> }> {
  const { app, config, gameType, generationService, generationJob, metrics } = server;

  await app.listen({ host: "0.0.0.0", port: config.SERVICE_PORT });
  app.log.info({ service: config.SERVICE_NAME, gameType }, "Service started");

  const background = (async () => {
    try {
      const catalogs = await generationService.refreshCatalogs();
      metrics.recordLog("info", "catalogs_initialized", {
        source: catalogs.source,
        categories: catalogs.categories.length,
      });
    } catch (error) {
      app.log.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Background catalog refresh failed; continuing with the local fallback catalogs"
      );
    }

    // The server may have been closed while the refresh was retrying.
    if (!app.server.listening) {
      return;
    }
    try {
      generationJob.start(app.log);
    } catch (error) {
      app.log.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Failed to start the periodic generation job"
      );
    }
  })();

  return { background };
}
