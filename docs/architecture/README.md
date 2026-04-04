# Architecture

microservice-wordpass follows a simple layered design:
- Route layer (Fastify routes)
- Service layer (ai-engine client + orchestration)
- Persistence layer (Prisma)

The service is intentionally scoped to a single game type: `word-pass`.
