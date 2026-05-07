# microservice-wordpass docs

Last updated: 2026-05-08.

Technical documentation for the word-pass domain service.

## Purpose

This local docs folder explains the concrete implementation surface of `microservice-wordpass`:

- word-pass-domain ownership and service architecture
- developer onboarding and local integration workflow
- deployment and operational procedures owned by this repository

## Navigation

- `architecture/README.md`: service-local architecture and owned domain boundaries.
- `guides/README.md`: developer onboarding and integration guide index.
- `operations/README.md`: deployment and operational guide index.

## Reading order

1. Start with `architecture/README.md`.
2. Continue with `guides/README.md` for local development and contract-facing work.
3. Use `operations/README.md` for deployment and runtime procedures.

## When to use this

- when the central platform docs are too broad for a word-pass service change
- when you need the repository-local navigation entry for architecture, guides, and operations

## CI/CD reference

- Repository workflow: `.github/workflows/ci.yml`.
- Push to `main` dispatches `platform-infra` image build for `microservice-wordpass`.
