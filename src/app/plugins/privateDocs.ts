import swaggerUi from "@fastify/swagger-ui";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AppConfig } from "../config.js";

export function resolvePrivateDocsToken(config: AppConfig): string | null {
  return config.PRIVATE_DOCS_TOKEN ?? config.AI_ENGINE_API_KEY ?? null;
}

export function isAuthorizedForPrivateDocs(
  request: FastifyRequest,
  expectedToken: string
): boolean {
  const headerToken = request.headers["x-private-docs-token"];
  const tokenFromHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  if (typeof tokenFromHeader === "string" && tokenFromHeader === expectedToken) {
    return true;
  }

  const authHeader = request.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim() === expectedToken;
  }

  return false;
}

export async function registerPrivateDocs(app: FastifyInstance, config: AppConfig): Promise<void> {
  if (!config.PRIVATE_DOCS_ENABLED) {
    return;
  }

  const privateDocsToken = resolvePrivateDocsToken(config);
  if (!privateDocsToken) {
    throw new Error("Private docs are enabled but no token is configured");
  }

  await app.register(swaggerUi, {
    routePrefix: config.PRIVATE_DOCS_PREFIX,
    staticCSP: true,
    transformSpecificationClone: true,
    uiHooks: {
      onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
        if (!isAuthorizedForPrivateDocs(request, privateDocsToken)) {
          return reply.code(401).send({ message: "Unauthorized private docs access" });
        }
        return;
      }
    }
  });
}
