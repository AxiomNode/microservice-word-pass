# Deployment

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
