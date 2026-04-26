import { GameServiceMetrics } from "@axiomnode/shared-sdk-client";

import type { AppConfig } from "../config.js";
import type { OutboundRequestMetric } from "./aiEngineClient.js";
import type { BatchGenerationResult, GenerationProcessSnapshot } from "./generationService.js";

/** @module serviceMetrics - Wordpass wrapper around the shared generated-game metrics collector. */

export class ServiceMetrics extends GameServiceMetrics<
  AppConfig,
  BatchGenerationResult,
  GenerationProcessSnapshot,
  OutboundRequestMetric
> {}
