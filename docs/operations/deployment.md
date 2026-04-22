# Deployment

## Scope

This document covers repository-local packaging and deployment behavior for `microservice-wordpass`.

## Build image
```bash
docker build -t microservice-wordpass:latest ./src
```

## Run container
```bash
docker run --rm -p 7101:7100 --env-file ./src/.env microservice-wordpass:latest
```

## Docker Compose (repository-local)

Run from repository root:

```bash
docker compose up -d --build
```

Stop and remove containers:

```bash
docker compose down
```

## Operational checks after container startup

Validate:

- `GET /health`
- private-docs protection if it is part of the release safety path
- one generation request when downstream AI is available
- one random-model read to confirm persistence path and retrieval path both work

## Automated CI/CD path

1. Push to `main` in this repository.
2. `.github/workflows/ci.yml` dispatches `platform-infra` build for `microservice-wordpass`.
3. `platform-infra` publishes the image to GHCR.
4. `platform-infra` deploy workflow applies rollout to `stg`.

## Common failure patterns

- image boots but private-docs behavior regresses
- generation path fails because AI target is busy or unreachable
- rollout succeeds while stored invalid rows later break read-path behavior
