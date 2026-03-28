import type { FastifyBaseLogger } from "fastify";
import { AppConfig } from "../config.js";
import { GenerationService } from "./generationService.js";

export class ModelGenerationJob {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly generationService: GenerationService
  ) {}

  start(logger: FastifyBaseLogger): void {
    if (!this.config.BATCH_GENERATION_ENABLED) {
      logger.info("Periodic model generation disabled");
      return;
    }

    const intervalMs = this.config.BATCH_GENERATION_INTERVAL_MINUTES * 60_000;

    void this.runCycle(logger, "startup");
    this.timer = setInterval(() => {
      void this.runCycle(logger, "interval");
    }, intervalMs);

    logger.info(
      {
        intervalMinutes: this.config.BATCH_GENERATION_INTERVAL_MINUTES,
        targetCount: this.config.BATCH_GENERATION_TARGET_COUNT,
        maxAttempts: this.config.BATCH_GENERATION_MAX_ATTEMPTS
      },
      "Periodic model generation scheduler started"
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async runCycle(logger: FastifyBaseLogger, trigger: "startup" | "interval") {
    if (this.running) {
      logger.warn({ trigger }, "Skipping generation cycle because previous cycle is still running");
      return;
    }

    this.running = true;
    const startedAt = Date.now();

    try {
      const smoke = await this.generationService.runAiAuthSmokeCheck();
      if (!smoke.ok) {
        logger.error(
          {
            trigger,
            durationMs: Date.now() - startedAt,
            reason: smoke.reason
          },
          "Skipping periodic generation cycle because AI auth smoke check failed"
        );
        return;
      }

      const catalogs = await this.generationService.refreshCatalogs();
      const result = await this.generationService.generateBatchModels();
      logger.info(
        {
          trigger,
          durationMs: Date.now() - startedAt,
          catalogSource: catalogs.source,
          categoryCount: catalogs.categories.length,
          languageCount: catalogs.languages.length,
          ...result
        },
        "Periodic model generation cycle finished"
      );
    } catch (error) {
      logger.error(
        {
          trigger,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : "Unknown error"
        },
        "Periodic model generation cycle failed"
      );
    } finally {
      this.running = false;
    }
  }
}
