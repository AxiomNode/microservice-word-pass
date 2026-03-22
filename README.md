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

Default ai-engine endpoint configured by this service: `/generate/word-pass`.

## API
- GET /health
- POST /games/generate
- POST /games/ingest
- GET /games/models/random
- GET /games/models/grouped
- GET /games/history

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
1. Add the language entry in [microservice-wordpass/src/app/services/triviaCategories.ts](microservice-wordpass/src/app/services/triviaCategories.ts).
2. Rebuild the service to refresh strict API validation enums.
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
