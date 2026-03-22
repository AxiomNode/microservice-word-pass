# Architecture

microservice-wordpass follows a simple layered design:
- Route layer (Fastify routes)
- Service layer (ai-engine client + orchestration)
- Persistence layer (Prisma)

The service is scoped to one game type: \.
