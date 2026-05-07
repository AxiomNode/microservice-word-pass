# microservice-wordpass

Last updated: 2026-05-03.

[![codecov](https://codecov.io/gh/AxiomNode/microservice-wordpass/branch/main/graph/badge.svg)](https://codecov.io/gh/AxiomNode/microservice-wordpass)

TypeScript microservice for word-pass generation and persistence.

## Responsibility

`microservice-wordpass` is the word-pass game domain service responsible for generation orchestration, persistence of generated models, and retrieval APIs tailored to the word-pass gameplay domain.

It depends on `ai-engine` for generation but owns domain validation, persistence, and retrieval behavior.

## Runtime role

### Main responsibilities

- Request word-pass generation from `ai-engine`.
- Persist generated word-pass models and history in PostgreSQL.
- Expose generation and catalog endpoints for BFF consumers.

### Ownership boundary

`microservice-wordpass` owns word-pass-domain correctness even when generation originates in `ai-engine`.

That includes:

- request shaping for word-pass generation
- validation of letters, hints, and topic coherence
- persistence of valid domain payloads
- retrieval semantics for reusable stored models

## Runtime surface

### Primary use cases

- request word-pass generation for a category and language
- ingest externally generated word-pass payloads
- retrieve reusable stored models
- inspect historical generated artifacts
- expose private docs and health endpoints used during release verification

Detailed generation semantics, repair behavior, and inventory handling are documented in the word-pass capability dossier so this README can stay at repository level.

### Stack

- Node.js 20+
- Fastify
- Zod
- Prisma
- PostgreSQL
- Vitest

## Local setup

### Project layout

- `src/`: service code, Prisma schema, tests, and Docker assets.
- `docs/`: architecture, guides, and operations docs.

### Local development

```bash
cd src
cp .env.example .env
npm install
npm run db:push
npm run dev
```

Inject real secrets from the private `secrets` repository when needed:

```bash
node scripts/prepare-runtime-secrets.mjs dev
```

### Route note

This service owns word-pass generation, ingest, random inventory, grouped inventory, maintenance, and history routes. Use `docs/architecture/README.md` and the word-pass inventory capability dossier for the concrete contract inventory.

## Dependencies and contracts

### Dependency model

Primary infrastructure dependency:

- PostgreSQL

Primary service dependencies:

- `ai-engine-api`
- `ai-engine-stats` via shared instrumentation paths where applicable

Primary consumers:

- `bff-mobile`
- `bff-backoffice`

### Private docs

- Route: `/private/docs`
- JSON: `/private/docs/json`
- Auth headers: `X-Private-Docs-Token` or `Authorization: Bearer <token>`

## Documentation

- `docs/README.md`
- `docs/architecture/README.md`
- `docs/guides/README.md`
- `docs/operations/README.md`

## Deployment and operations notes

### CI/CD and rollout note

CI, smoke checks, and staging rollout behavior are documented in `docs/operations/README.md` and `../docs/operations/cicd-workflow-map.md`.

### Resilience notes

- This service should degrade gracefully when invalid persisted generated rows are encountered.
- Retry and timeout behavior for `ai-engine` calls should remain explicit in configuration and test coverage.
- Async generation process items use `GAME_GENERATION_ITEM_TIMEOUT_MS` and `GAME_GENERATION_ITEM_RETRY_MAX_ATTEMPTS` so blocked LLM calls become explicit `timeout` item progress events instead of indefinite `running` tasks.
- Release confidence depends on both repository validation and central deployment validation.

### Failure boundaries

- upstream AI returns malformed or weak domain content
- generation request times out or is rejected because AI runtime is busy
- persistence fails after successful validation
- stored invalid rows degrade random selection or history endpoints

## References

- `docs/architecture/`
- `docs/operations/`
- `../docs/guides/capabilities/domain/wordpass-inventory-and-generation.md`
- `../docs/operations/cicd-workflow-map.md`
