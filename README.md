# microservice-wordpass

TypeScript microservice that requests **word-pass** generation from **ai-engine** and persists generated sessions in a database.

## Stack
- Runtime: Node.js 20+
- Framework: Fastify
- Validation: Zod
- ORM: Prisma
- Database: PostgreSQL (containerized with persistent volume)
- Tests: Vitest

## Project layout
- docs/: architecture, guides, operations
- src/: application code, Prisma schema, Docker assets, tests

## Quick start

```bash
cd src
cp .env.example .env
npm install
npm run db:push
npm run dev
```

`.env.example` contiene placeholders. Para inyectar secretos reales en `src/.env.secrets`, ejecutar desde el repositorio privado `secrets`:

```bash
node scripts/prepare-runtime-secrets.mjs dev
```

Default ai-engine endpoint configured by this service: `/generate/word-pass`.

## Shared modules

Este servicio consume modulos compartidos de `@axiomnode/shared-sdk-client`:

- `src/app/services/aiEngineClient.ts` re-exporta `@axiomnode/shared-sdk-client/ai-engine-client`.
- `src/app/services/triviaCategories.ts` re-exporta `@axiomnode/shared-sdk-client/trivia-categories`.
- `src/app/plugins/privateDocs.ts` delega en `@axiomnode/shared-sdk-client/private-docs`.

## Integracion En Nueva Arquitectura

Este servicio pasa a ser un servicio de dominio interno en el modelo Gateway + BFF.

- Entrada publica esperada: `api-gateway`.
- Consumidores directos recomendados: `bff-mobile`, `bff-backoffice`.
- Exposicion directa a internet: solo temporal durante la migracion.

Contrato interno inicial publicado en:

- `contracts-and-schemas/schemas/openapi/internal-microservice-wordpass.v1.yaml`

## API
- GET /health
- POST /games/generate
- POST /games/ingest
- GET /games/models/random
- GET /games/models/grouped
- GET /games/history

## Private API Docs (Swagger-like)

The service exposes private OpenAPI docs for internal testing.

- UI route: `/private/docs` (configurable with `PRIVATE_DOCS_PREFIX`)
- Access header: `X-Private-Docs-Token: <token>`
- Alternative header: `Authorization: Bearer <token>`

Token resolution:

- Uses `PRIVATE_DOCS_TOKEN` when provided.
- Falls back to `AI_ENGINE_API_KEY` if `PRIVATE_DOCS_TOKEN` is empty.

Key env vars:

- `PRIVATE_DOCS_ENABLED=true|false`
- `PRIVATE_DOCS_PREFIX=/private/docs`
- `PRIVATE_DOCS_TOKEN=wordpass_private_docs_token`

### Quick verification (private docs)

With service running on localhost:

```bash
# expected 401 (no token)
python - <<'PY'
import urllib.request, urllib.error
try:
	urllib.request.urlopen('http://localhost:7101/private/docs/json')
except urllib.error.HTTPError as e:
	print(e.code)
PY

# expected 200 (with token)
python - <<'PY'
import urllib.request
req = urllib.request.Request(
	'http://localhost:7101/private/docs/json',
	headers={'X-Private-Docs-Token': 'wordpass_private_docs_token'}
)
with urllib.request.urlopen(req) as r:
	print(r.getcode())
PY
```

### CI in repository scope

This repository has its own GitHub Actions workflow:

- `.github/workflows/ci.yml`

The workflow runs build, tests, lint, production audit and docker smoke checks for private docs.

## Core responsibilities
- Ingest game-specific knowledge into ai-engine RAG via /games/ingest.
- Generate and persist word-pass models in local database via /games/generate.
- Serve random persisted models with optional filters using /games/models/random.

## Periodic generation job
- The service runs a scheduler (enabled by default) every 20 minutes.
- Each cycle targets 1000 new models distributed equitably across category-language pairs.
- Duplicate prevention is applied before saving:
	- normalized topic key (avoid near-identical topics),
	- response fingerprint hash (avoid repeated model content).

## Fixed dimensions
- Allowed languages (fixed): es, en, fr, de, it.
- Allowed categories: the provided trivia category catalog (ids 9-32 subset).
- Generation outside these dimensions is rejected at API and service level.

## How to add more languages later
1. Language catalog is centralized in `shared-sdk-client/typescript/src/trivia-categories.ts`.
2. Rebuild shared SDK and then rebuild this service to refresh strict API validation enums.
3. Keep two-letter codes and update clients that call /games/generate or /games/models/random.

## Docker Compose

This repository ships its own root-level compose file:

```bash
docker compose up -d --build
docker compose down
```

Compose starts two services:
- `microservice-wordpass` (API service)
- `wordpass-db` (PostgreSQL 16 with named volume `wordpass_db_data`)

Default Docker database URL used by the API container:
- `postgresql://wordpass:wordpass@wordpass-db:5432/wordpassdb?schema=public`
