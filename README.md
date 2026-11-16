# microservice-wordpass (archived)

> **This repository is archived and no longer maintained.** The word-pass service lives in
> [AxiomNode/microservice-games](https://github.com/AxiomNode/microservice-games) (formerly `microservice-quizz`).
> Open issues and pull requests there.

## Where things went

| Before (this repo) | Now |
|---|---|
| Word-pass service code (`src/app`) | One code base in `microservice-games`; the game is chosen by `GAME_TYPE=word-pass` and its rules live in `src/app/games/wordpass.ts` |
| `microservice-wordpass-api` image | The merged `microservice-games-api` image, deployed as the same `microservice-wordpass-api` Deployment and Service (URLs, port 7100 and the BFF/gateway settings did not change) |
| Own PostgreSQL (`wordpassdb`) | The shared quiz database; every row carries its `gameType` |
| Own CI and image dispatch | The CI of `microservice-games` |

## What stays here

The final state of the word-pass service before the merge is kept as read-only history (last functional change: `perf: aggregate history insights, id-sampled random models, listen-before-catalogs`). Do not build or deploy from this repository.
