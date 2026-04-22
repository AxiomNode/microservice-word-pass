# microservice-wordpass

[![codecov](https://codecov.io/gh/AxiomNode/microservice-wordpass/branch/main/graph/badge.svg)](https://codecov.io/gh/AxiomNode/microservice-wordpass)

TypeScript microservice for word-pass generation and persistence.

## Architectural role

`microservice-wordpass` is the word-pass game domain service responsible for generation orchestration, persistence of generated models, and retrieval APIs tailored to the word-pass gameplay domain.

It depends on `ai-engine` for generation but owns domain validation, persistence, and retrieval behavior.

## Responsibilities

- Request word-pass generation from `ai-engine`.
- Persist generated word-pass models and history in PostgreSQL.
- Expose generation and catalog endpoints for BFF consumers.

## Ownership boundary

`microservice-wordpass` owns word-pass-domain correctness even when generation originates in `ai-engine`.

That includes:

- request shaping for word-pass generation
- validation of letters, hints, and topic coherence
- persistence of valid domain payloads
- retrieval semantics for reusable stored models

## Primary use cases

- request word-pass generation for a category and language
- ingest externally generated word-pass payloads
- retrieve reusable stored models
- inspect historical generated artifacts
- expose private docs and health endpoints used during release verification

## Stack

- Node.js 20+
- Fastify
- Zod
- Prisma
- PostgreSQL
- Vitest

## Project layout

- `src/`: service code, Prisma schema, tests, and Docker assets.
- `docs/`: architecture, guides, and operations docs.

## Local development

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

## API highlights

- `GET /health`
- `POST /games/generate`
- `POST /games/ingest`
- `GET /games/models/random`
- `GET /games/models/grouped`
- `GET /games/history`

## Dependency model

Primary infrastructure dependency:

- PostgreSQL

Primary service dependencies:

- `ai-engine-api`
- `ai-engine-stats` via shared instrumentation paths where applicable

Primary consumers:

- `bff-mobile`
- `bff-backoffice`

## Private docs

- Route: `/private/docs`
- JSON: `/private/docs/json`
- Auth headers: `X-Private-Docs-Token` or `Authorization: Bearer <token>`

## CI/CD workflow behavior

- `.github/workflows/ci.yml`
  - Trigger: push (`main`, `develop`), pull request, manual dispatch.
  - Job `build-test-lint-audit`: build, test, lint, npm production audit.
  - Job `docker-smoke-private-docs`: validates container startup + private docs auth behavior.
  - Job `trigger-platform-infra-build`:
    - Runs on push to `main`.
    - Waits for `build-test-lint-audit` and `docker-smoke-private-docs` to succeed before dispatching `platform-infra`.
    - Dispatches `platform-infra/.github/workflows/build-push.yaml` with `service=microservice-wordpass`.
    - Requires `PLATFORM_INFRA_DISPATCH_TOKEN` in this repo.

## Deployment automation chain

Push to `main` triggers image rebuild in `platform-infra`, followed by automatic deployment to `stg`.

## Resilience notes

- This service should degrade gracefully when invalid persisted generated rows are encountered.
- Retry and timeout behavior for `ai-engine` calls should remain explicit in configuration and test coverage.
- Release confidence depends on both repository validation and central deployment validation.

## Failure boundaries

- upstream AI returns malformed or weak domain content
- generation request times out or is rejected because AI runtime is busy
- persistence fails after successful validation
- stored invalid rows degrade random selection or history endpoints

## Related documents

- `docs/architecture/`
- `docs/operations/`
