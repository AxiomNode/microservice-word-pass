# microservice-wordpass

TypeScript microservice for word-pass generation and persistence.

## Responsibilities

- Request word-pass generation from `ai-engine`.
- Persist generated word-pass models and history in PostgreSQL.
- Expose generation and catalog endpoints for BFF consumers.

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
    - Dispatches `platform-infra/.github/workflows/build-push.yaml` with `service=microservice-wordpass`.
    - Requires `PLATFORM_INFRA_DISPATCH_TOKEN` in this repo.

## Deployment automation chain

Push to `main` triggers image rebuild in `platform-infra`, followed by automatic deployment to `dev`.
