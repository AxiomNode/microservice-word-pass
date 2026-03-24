import swaggerUi from "@fastify/swagger-ui";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  isAuthorizedForPrivateDocs as isAuthorizedForPrivateDocsShared,
  resolvePrivateDocsToken as resolvePrivateDocsTokenShared
} from "@axiomnode/shared-sdk-client/private-docs";

import { AppConfig } from "../config.js";

export function resolvePrivateDocsToken(config: AppConfig): string | null {
  return resolvePrivateDocsTokenShared(config, { fallbackToAiEngineKey: true });
}

export function isAuthorizedForPrivateDocs(
  request: FastifyRequest,
  expectedToken: string
): boolean {
  return isAuthorizedForPrivateDocsShared(request.headers, expectedToken);
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
