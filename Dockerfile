# Labyrinthium — single container: game server + built web client.
# Railway/Fly/Render: just point at this Dockerfile. The platform's PORT
# env var is respected; /health is the healthcheck endpoint.

FROM node:22-bookworm AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm -r build

# Keep the workspace layout: the server serves ../web/dist relative to itself.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

# Game history lives in SQLite. Mount a volume here to keep replays across
# deploys (Railway: add a volume at /data); without one, games are ephemeral.
ENV LABYRINTHIUM_DB=/data/labyrinthium.sqlite
RUN mkdir -p /data

EXPOSE 8080
CMD ["node", "packages/server/dist/index.js"]
