> **Archived: this service moved to [AxiomNode/microservice-games](https://github.com/AxiomNode/microservice-games).**
> One code base now runs both games (quiz and word-pass), selected by `GAME_TYPE`. Contribute there; this repository takes no further changes.

# Contributing

## Branching model
- main: production-ready
- develop: integration branch
- feature/<ticket>-<short-name>
- release/<version>
- hotfix/<ticket>-<short-name>

## Local setup
```bash
cd src
npm install
npm run db:push
npm run dev
```

## Quality commands
```bash
cd src
npm run lint
npm run test
npm run build
npm run format:check
```

## Commit messages
Use Conventional Commits:
- feat:
- fix:
- docs:
- test:
- chore:
- refactor:
