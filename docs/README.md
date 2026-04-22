# microservice-wordpass docs

Technical documentation for the word-pass domain service.

## Purpose

This local docs folder explains the concrete implementation surface of `microservice-wordpass`:

- word-pass-domain ownership and service architecture
- developer onboarding and local integration workflow
- deployment and operational procedures owned by this repository

## Contents

- `architecture/README.md`: service-local architecture and owned domain boundaries.
- `guides/README.md`: developer onboarding and integration guide index.
- `operations/README.md`: deployment and operational guide index.

## Reading order

1. Start with `architecture/README.md`.
2. Continue with `guides/README.md` for local development and contract-facing work.
3. Use `operations/README.md` for deployment and runtime procedures.

## CI/CD reference

- Repository workflow: `.github/workflows/ci.yml`.
- Push to `main` dispatches `platform-infra` image build for `microservice-wordpass`.
