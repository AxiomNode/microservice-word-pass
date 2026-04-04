# AGENTS

## Repo purpose
Word-pass generation and persistence microservice backed by ai-engine and PostgreSQL.

## Key paths
- src/: Fastify handlers, business logic, Prisma, tests
- docs/: architecture, guides, operations
- .github/workflows/ci.yml: CI + infra dispatch

## Local commands
- cd src && npm install
- cd src && npm run db:push && npm run dev
- cd src && npm test && npm run lint && npm run build

## CI/CD notes
- Push to main dispatches platform-infra build-push with service=microservice-wordpass.
- Deployment to dev is automated from platform-infra.

## LLM editing rules
- Keep generate/ingest/catalog endpoints stable.
- Maintain parity between Prisma models and API response fields.
- Update docs when changing ports, routes, or workflow behavior.
