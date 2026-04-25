import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../app/config.js";

const originalEnv = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...originalEnv, ...overrides };
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadConfig", () => {
  it("loads defaults and only normalizes the optional fields wired through OptionalEnvString", () => {
    withEnv({
      DATABASE_URL: "postgresql://wordpass:wordpass@localhost:7433/wordpassdb?schema=public",
      PRIVATE_DOCS_ENABLED: "false",
      PRIVATE_DOCS_TOKEN: "   ",
      AI_ENGINE_INGEST_SOURCE: "   ",
    });

    const config = loadConfig();

    expect(config.SERVICE_NAME).toBe("microservice-wordpass");
    expect(config.PRIVATE_DOCS_ENABLED).toBe(false);
    expect(config.PRIVATE_DOCS_TOKEN).toBeUndefined();
    expect(config.AI_ENGINE_INGEST_SOURCE).toBe("   ");
    expect(config.BATCH_GENERATION_ENABLED).toBe(false);
  });

  it("accepts private docs when an explicit token is configured", () => {
    withEnv({
      DATABASE_URL: "postgresql://wordpass:wordpass@localhost:7433/wordpassdb?schema=public",
      PRIVATE_DOCS_ENABLED: "true",
      PRIVATE_DOCS_TOKEN: "docs-token",
      AI_ENGINE_API_KEY: undefined,
      BATCH_GENERATION_INTERVAL_MINUTES: "15",
    });

    const config = loadConfig();

    expect(config.PRIVATE_DOCS_ENABLED).toBe(true);
    expect(config.PRIVATE_DOCS_TOKEN).toBe("docs-token");
    expect(config.BATCH_GENERATION_INTERVAL_MINUTES).toBe(15);
  });

  it("accepts private docs when only AI_ENGINE_API_KEY is configured", () => {
    withEnv({
      DATABASE_URL: "postgresql://wordpass:wordpass@localhost:7433/wordpassdb?schema=public",
      PRIVATE_DOCS_ENABLED: "on",
      PRIVATE_DOCS_TOKEN: "",
      AI_ENGINE_API_KEY: "fallback-key",
    });

    const config = loadConfig();

    expect(config.PRIVATE_DOCS_ENABLED).toBe(true);
    expect(config.AI_ENGINE_API_KEY).toBe("fallback-key");
  });

  it("fails when private docs are enabled without PRIVATE_DOCS_TOKEN or AI_ENGINE_API_KEY", () => {
    withEnv({
      DATABASE_URL: "postgresql://wordpass:wordpass@localhost:7433/wordpassdb?schema=public",
      PRIVATE_DOCS_ENABLED: "yes",
      PRIVATE_DOCS_TOKEN: undefined,
      AI_ENGINE_API_KEY: undefined,
    });

    expect(() => loadConfig()).toThrow("Private docs require PRIVATE_DOCS_TOKEN or AI_ENGINE_API_KEY");
  });

  it("fails when numeric constraints are invalid", () => {
    withEnv({
      DATABASE_URL: "postgresql://wordpass:wordpass@localhost:7433/wordpassdb?schema=public",
      PRIVATE_DOCS_ENABLED: "false",
      AI_ENGINE_REQUEST_TIMEOUT_MS: "1000",
    });

    expect(() => loadConfig()).toThrow();
  });

  it("fails when PRIVATE_DOCS_ENABLED is not a recognized boolean", () => {
    withEnv({
      DATABASE_URL: "postgresql://wordpass:wordpass@localhost:7433/wordpassdb?schema=public",
      PRIVATE_DOCS_ENABLED: "maybe",
    });

    expect(() => loadConfig()).toThrow();
  });
});