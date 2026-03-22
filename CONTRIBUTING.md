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
