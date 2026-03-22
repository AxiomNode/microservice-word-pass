import "dotenv/config";

import { describe, expect, it } from "vitest";

import Fastify from "fastify";
import swagger from "@fastify/swagger";

import { AppConfig } from "../app/config.js";
import {
  registerPrivateDocs,
  resolvePrivateDocsToken
} from "../app/plugins/privateDocs.js";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    SERVICE_NAME: "microservice-wordpass",
    SERVICE_PORT: 7100,
    NODE_ENV: "test",
    AI_ENGINE_BASE_URL: "http://localhost:7001",
    AI_ENGINE_GENERATION_ENDPOINT: "/generate/word-pass",
    AI_ENGINE_INGEST_ENDPOINT: "/ingest/word-pass",
    AI_ENGINE_CATALOGS_ENDPOINT: "/catalogs",
    AI_ENGINE_INGEST_SOURCE: "microservice-wordpass",
    AI_ENGINE_API_KEY: "fallback_token",
    AI_ENGINE_INGEST_API_KEY: "bridge_token",
    AI_ENGINE_REQUEST_TIMEOUT_MS: 420000,
    PRIVATE_DOCS_ENABLED: true,
    PRIVATE_DOCS_PREFIX: "/private/docs",
    PRIVATE_DOCS_TOKEN: "private_token",
    METRICS_LOG_BUFFER_SIZE: 500,
    BATCH_GENERATION_ENABLED: true,
    BATCH_GENERATION_INTERVAL_MINUTES: 20,
    BATCH_GENERATION_TARGET_COUNT: 40,
    BATCH_GENERATION_MAX_ATTEMPTS: 160,
    BATCH_GENERATION_CONCURRENCY: 2,
    BATCH_GENERATION_MIN_DIFFICULTY: 25,
    BATCH_GENERATION_MAX_DIFFICULTY: 85,
    BATCH_GENERATION_MIN_QUESTIONS: 5,
    BATCH_GENERATION_MAX_QUESTIONS: 10,
    DATABASE_URL: "postgresql://wordpass:wordpass@localhost:7433/wordpassdb?schema=public",
    ...overrides
  };
}

describe("private docs plugin", () => {
  it("uses PRIVATE_DOCS_TOKEN over fallback", () => {
    const token = resolvePrivateDocsToken(
      baseConfig({ PRIVATE_DOCS_TOKEN: "explicit_token", AI_ENGINE_API_KEY: "fallback_token" })
    );

    expect(token).toBe("explicit_token");
  });

  it("falls back to AI_ENGINE_API_KEY", () => {
    const token = resolvePrivateDocsToken(
      baseConfig({ PRIVATE_DOCS_TOKEN: undefined, AI_ENGINE_API_KEY: "fallback_token" })
    );

    expect(token).toBe("fallback_token");
  });

  it("protects /private/docs/json with token", async () => {
    const app = Fastify();
    await app.register(swagger, {
      openapi: { info: { title: "test", version: "1.0.0" } }
    });

    await registerPrivateDocs(app, baseConfig({ PRIVATE_DOCS_TOKEN: "secret_value" }));

    const unauthorized = await app.inject({
      method: "GET",
      url: "/private/docs/json"
    });

    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: "GET",
      url: "/private/docs/json",
      headers: { "x-private-docs-token": "secret_value" }
    });

    expect(authorized.statusCode).toBe(200);
    await app.close();
  });
});
