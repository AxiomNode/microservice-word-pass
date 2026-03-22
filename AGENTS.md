# Agents & Contribution Rules for microservice-wordpass

Purpose
-------
This document defines agent rules, development workflow, and code quality standards for the microservice-wordpass repository.

Core Rules
----------
1) Git Flow
   - Use:      - main (production)     - develop (integration)     - feature/*, release/*, hotfix/*.

2) TDD
   - Write a failing test first.
   - Implement the minimum code to pass.
   - Refactor with tests green.

3) English-only docs
   - All code comments, docs, and commit messages must be in English.

4) TypeScript quality bar
   - Strict TypeScript enabled.
   - ESLint + Prettier + Vitest required on every PR.
   - Keep services small and dependency-injected.

Enforcement & CI
----------------
- Required checks on every PR:
  - npm run lint
  - npm run test
  - npm run build

PR Checklist
------------
- Tests added/updated.
- Docs updated.
- No debug leftovers.
- CI green before merge.
