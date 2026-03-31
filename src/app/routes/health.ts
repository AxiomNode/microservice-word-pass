import { FastifyInstance } from "fastify";

/** @module health - Simple health-check route for liveness probes. */

/** Registers the GET /health endpoint returning service status. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "microservice-wordpass",
      gameType: "word-pass"
    };
  });
}
