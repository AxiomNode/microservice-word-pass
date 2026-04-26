import type { FastifyBaseLogger } from "fastify";
import { GameModelGenerationJob } from "@axiomnode/shared-sdk-client";

import { AppConfig } from "../config.js";
import { GenerationService } from "./generationService.js";

/** @module modelGenerationJob - Periodic scheduler that batch-generates word-pass models on a timer. */

/** Manages a recurring interval that triggers batch model generation via the GenerationService. */
export class ModelGenerationJob extends GameModelGenerationJob<AppConfig, GenerationService> {
  protected override async runCycle(logger: FastifyBaseLogger, trigger: "startup" | "interval") {
    return super.runCycle(logger, trigger);
  }
}
