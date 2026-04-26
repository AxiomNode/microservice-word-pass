import type { FastifyBaseLogger } from "fastify";
import {
  GameRuntimeGenerationWorker,
  RuntimeDifficultyLevel,
  RuntimeGenerationWorkerSnapshot as SharedRuntimeGenerationWorkerSnapshot,
  RuntimeGenerationWorkerStartInput,
} from "@axiomnode/shared-sdk-client";

import { prisma } from "../db/client.js";
import { GenerationService } from "./generationService.js";

export type { RuntimeDifficultyLevel, RuntimeGenerationWorkerStartInput };
export type RuntimeGenerationWorkerSnapshot = SharedRuntimeGenerationWorkerSnapshot<"word-pass">;

/**
 * Runtime worker that starts/stops periodic AI generation cycles without restarting the service.
 * It runs one cycle every interval and tracks counters that the backoffice can inspect.
 */
export class RuntimeGenerationWorker extends GameRuntimeGenerationWorker<"word-pass", GenerationService> {
  constructor(generationService: GenerationService) {
    super("word-pass", generationService, {
      countByGameType: (gameType) =>
        prisma.gameGeneration.count({
          where: { gameType },
        }),
      listDifficultyPercentages: (gameType) =>
        prisma.gameGeneration.findMany({
          where: { gameType },
          select: { difficultyPercentage: true },
        }),
    });
  }

  override bindLogger(logger: FastifyBaseLogger): void {
    super.bindLogger(logger);
  }
}
