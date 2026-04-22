# Architecture

microservice-wordpass follows a simple layered design:
- Route layer (Fastify routes)
- Service layer (ai-engine client + orchestration)
- Persistence layer (Prisma)

The service is intentionally scoped to a single game type: `word-pass`.

## Owned responsibilities

This repository owns word-pass-domain behavior for:

- shaping generation requests
- validating letters, hints, and topic coherence
- persisting reusable word-pass models and history
- serving retrieval paths for random and grouped word-pass content

## Dependency model

Primary infrastructure dependency:

- PostgreSQL

Primary service dependency:

- `ai-engine-api` for generation and ingest-related flows

## Architectural constraints

- do not move word-pass validation rules into a BFF
- do not trust AI output until domain validation succeeds
- treat retrieval quality as a first-class concern alongside generation quality

## Failure boundaries

- generation returns syntactically valid but domain-invalid word-pass content
- persistence succeeds while later retrieval surfaces weak stored payloads
- read-path failures appear independently from generation-path availability

## When to update

Update this section when changing service layering, AI orchestration boundaries, or word-pass-domain ownership rules.
