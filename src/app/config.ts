import { z } from "zod";

const ConfigSchema = z.object({
  SERVICE_NAME: z.string().default("microservice-wordpass"),
  SERVICE_PORT: z.coerce.number().int().positive().default(7100),
  NODE_ENV: z.string().default("development"),
  AI_ENGINE_BASE_URL: z.string().url().default("http://localhost:7001"),
  AI_ENGINE_GENERATION_ENDPOINT: z.string().default("/generate/word-pass"),
  AI_ENGINE_INGEST_ENDPOINT: z.string().default("/ingest/word-pass"),
  AI_ENGINE_CATALOGS_ENDPOINT: z.string().default("/catalogs"),
  AI_ENGINE_INGEST_SOURCE: z.string().min(1).optional(),
  AI_ENGINE_API_KEY: z.string().min(1).optional(),
  AI_ENGINE_INGEST_API_KEY: z.string().min(1).optional(),
  AI_ENGINE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5000).max(1800000).default(420000),
  METRICS_LOG_BUFFER_SIZE: z.coerce.number().int().min(50).max(5000).default(500),
  BATCH_GENERATION_ENABLED: z.coerce.boolean().default(true),
  BATCH_GENERATION_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(240).default(20),
  BATCH_GENERATION_TARGET_COUNT: z.coerce.number().int().min(1).max(5000).default(1000),
  BATCH_GENERATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20000).default(4000),
  BATCH_GENERATION_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  BATCH_GENERATION_MIN_DIFFICULTY: z.coerce.number().int().min(0).max(100).default(25),
  BATCH_GENERATION_MAX_DIFFICULTY: z.coerce.number().int().min(0).max(100).default(85),
  BATCH_GENERATION_MIN_QUESTIONS: z.coerce.number().int().min(1).max(50).default(5),
  BATCH_GENERATION_MAX_QUESTIONS: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_URL: z.string().min(1)
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error();
  }
  return parsed.data;
}
