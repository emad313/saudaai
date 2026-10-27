FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter web build

ENV NODE_ENV=production \
  PORT=8787 \
  DATABASE_URL=file:/data/saudaai.db \
  MEDIA_DIR=/data/media \
  WEB_DIST=/app/apps/web/dist
VOLUME /data
EXPOSE 8787

WORKDIR /app/apps/server
CMD ["sh", "-c", "npx tsx scripts/seed.ts && npx tsx src/index.ts"]
