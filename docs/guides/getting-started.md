# Getting Started

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

5. Generate a word-pass session:

```bash
curl -X POST http://localhost:7101/games/generate \
  -H "Content-Type: application/json" \
  -d '{"categoryId":"17","language":"es","difficultyPercentage":55,"numQuestions":7}'
```

6. Retrieve random models filtered by language and category:

```bash
curl "http://localhost:7101/games/models/random?count=10&language=es&categoryId=17"
```

7. Group model counts by category and language:

```bash
curl "http://localhost:7101/games/models/grouped"
```

## Fixed language policy

- Active fixed languages: `es`, `en`, `fr`, `de`, `it`.
- To add a new language later, edit `shared-sdk-client/typescript/src/trivia-categories.ts` and then restart/rebuild.
