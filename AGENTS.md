> **Archived: this service moved to [AxiomNode/microservice-games](https://github.com/AxiomNode/microservice-games).**
> One code base now runs both games (quiz and word-pass), selected by `GAME_TYPE`. Work on word-pass there; this repository takes no further changes.

# AGENTS

## Repo purpose
Word-pass generation and persistence microservice backed by ai-engine and PostgreSQL.

## Key paths
- src/: Fastify handlers, business logic, Prisma, tests
- docs/: architecture, guides, operations
- .github/workflows/ci.yml: CI only (the platform-infra dispatch was removed on archive)

## Local commands
- cd src && npm install
- cd src && npm run db:push && npm run dev
- cd src && npm test && npm run lint && npm run build

## CI/CD notes
- Nothing builds or deploys from this repository any more; images come from microservice-games.
- Platform-infra builds and publishes the image to GHCR; the automatic staging rollout is currently disabled.

## LLM editing rules
- Keep generate/ingest/catalog endpoints stable.
- Maintain parity between Prisma models and API response fields.
- Update docs when changing ports, routes, or workflow behavior.
