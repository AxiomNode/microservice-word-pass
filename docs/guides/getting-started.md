# Getting Started

## Scope

This guide covers local development and basic runtime verification for `microservice-wordpass`.

## Prerequisites

Before starting, ensure:

- Node.js and npm are available
- PostgreSQL is reachable for the configured local environment
- required secrets have been prepared from the private `secrets` repository
- downstream AI integration is available if generation endpoints will be tested end-to-end

## Local setup

1. Install dependencies:

```bash
cd src
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

Inject real secrets from private repository `secrets`:

```bash
node scripts/prepare-runtime-secrets.mjs dev
```

This generates `src/.env.secrets` for this service.

3. Initialize database:

```bash
npm run db:push
```

4. Run dev server:

```bash
npm run dev
```

## Smoke path examples

5. Generate a word-pass session:

```bash
curl -X POST http://localhost:7101/games/generate \
  -H "Content-Type: application/json" \
  -d '{"categoryId":"17","difficultyPercentage":55,"numQuestions":7}'
```

6. Retrieve random models filtered by category:

```bash
curl "http://localhost:7101/games/models/random?count=10&categoryId=17"
```

7. Group model counts by category:

```bash
curl "http://localhost:7101/games/models/grouped"
```

## Development notes

- generation success depends on downstream AI availability and domain validation quality
- random-model reads can surface stored-payload issues that are not visible on the initial generation path
- category behavior should stay aligned with the shared SDK catalogs and English-only contracts

## English-only policy

- The public generation contract is English-only and does not accept a client-supplied language field.
- If the runtime catalog changes later, update [shared-sdk-client/typescript/src/game-schemas.ts](shared-sdk-client/typescript/src/game-schemas.ts) and [shared-sdk-client/typescript/src/game-categories.ts](shared-sdk-client/typescript/src/game-categories.ts), then restart and rebuild the service.
