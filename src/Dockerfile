FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/microservice-wordpass/src
COPY microservice-wordpass/src/package.json microservice-wordpass/src/package-lock.json* ./
COPY shared-sdk-client/typescript /workspace/shared-sdk-client/typescript
RUN npm install

FROM node:20-bookworm-slim AS build
WORKDIR /workspace/microservice-wordpass/src
RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=deps /workspace/microservice-wordpass/src/node_modules ./node_modules
COPY microservice-wordpass/src .
RUN npm run db:generate && npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=build /workspace/microservice-wordpass/src/node_modules ./node_modules
COPY --from=build /workspace/microservice-wordpass/src/dist ./dist
COPY --from=build /workspace/microservice-wordpass/src/prisma ./prisma
COPY --from=build /workspace/microservice-wordpass/src/.env.example ./.env.example
EXPOSE 7100
CMD ["sh", "-c", "npx prisma db push && node dist/app/server.js"]
