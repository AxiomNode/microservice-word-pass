/** @module config - Zod-validated environment configuration for the wordpass microservice. */
import { createGameConfigSchema, loadGameConfig } from "@axiomnode/shared-sdk-client";
import { z } from "zod";

const ConfigSchema = createGameConfigSchema({
  serviceName: "microservice-wordpass",
  servicePort: 7101,
  generationEndpoint: "/generate/word-pass",
  ingestEndpoint: "/ingest/word-pass",
  maxQuestionsDefault: 10
});

/** Fully validated application configuration derived from environment variables. */
export type AppConfig = z.infer<typeof ConfigSchema>;

/** Parses and validates environment variables into a typed AppConfig, throwing on invalid input. */
export function loadConfig(): AppConfig {
  return loadGameConfig(ConfigSchema);
}
