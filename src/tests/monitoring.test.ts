import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

import { monitoringRoutes } from "../app/routes/monitoring.js";

describe("monitoring routes", () => {
  it("returns stats enriched with catalog coverage and grouped data", async () => {
    const app = Fastify();
    const metrics = {
      snapshot: vi.fn().mockReturnValue({ service: "microservice-wordpass", traffic: { requestsReceivedTotal: 3 } }),
      recentLogs: vi.fn(),
      toPrometheus: vi.fn(),
    };
    const generationService = {
      getCatalogSnapshot: vi.fn().mockReturnValue({
        source: "seed",
        categories: [{ id: "1" }, { id: "2" }],
      }),
      groupedModelsSummary: vi.fn().mockResolvedValue({
        categories: [{ total: 2 }, { total: 0 }],
        matrix: [{}, {}],
      }),
    };

    await monitoringRoutes(app, metrics as never, generationService as never);

    const response = await app.inject({ method: "GET", url: "/monitor/stats" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "microservice-wordpass",
      coverage: {
        catalogSource: "seed",
        totalCategories: 2,
        categoriesWithData: 1,
        matrixSlotsWithData: 2,
        categoryCoverageRatioFromMatrix: 1,
      },
    });

    await app.close();
  });

  it("returns logs with defaults, rejects invalid queries, and exposes prometheus metrics", async () => {
    const app = Fastify();
    const metrics = {
      snapshot: vi.fn(),
      recentLogs: vi.fn().mockReturnValue([{ message: "kept", level: "info" }]),
      toPrometheus: vi.fn().mockReturnValue("microservice_requests_received_total 5"),
    };
    const generationService = {
      getCatalogSnapshot: vi.fn(),
      groupedModelsSummary: vi.fn(),
    };

    await monitoringRoutes(app, metrics as never, generationService as never);

    const logsResponse = await app.inject({ method: "GET", url: "/monitor/logs" });
    const invalidResponse = await app.inject({ method: "GET", url: "/monitor/logs?limit=0" });
    const metricsResponse = await app.inject({ method: "GET", url: "/metrics" });

    expect(logsResponse.statusCode).toBe(200);
    expect(metrics.recentLogs).toHaveBeenCalledWith(200);
    expect(logsResponse.json()).toMatchObject({ service: "microservice-wordpass", total: 1 });
    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({ message: "Invalid query parameters" });
    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.body).toContain("microservice_requests_received_total 5");

    await app.close();
  });

  it("returns zero coverage ratios when catalogs are empty", async () => {
    const app = Fastify();
    const metrics = {
      snapshot: vi.fn().mockReturnValue({ service: "microservice-wordpass" }),
      recentLogs: vi.fn(),
      toPrometheus: vi.fn(),
    };
    const generationService = {
      getCatalogSnapshot: vi.fn().mockReturnValue({ source: "empty", categories: [] }),
      groupedModelsSummary: vi.fn().mockResolvedValue({ categories: [], matrix: [] }),
    };

    await monitoringRoutes(app, metrics as never, generationService as never);

    const response = await app.inject({ method: "GET", url: "/monitor/stats" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      coverage: {
        totalCategories: 0,
        categoryCoverageRatio: 0,
        categoryCoverageRatioFromMatrix: 0,
      },
    });

    await app.close();
  });
});