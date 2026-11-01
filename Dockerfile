FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/demo-store/package.json apps/demo-store/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile \
  && pnpm --filter server exec playwright install --with-deps chromium

COPY . .
RUN pnpm --filter web build

ENV NODE_ENV=production \
  PORT=8787 \
  DATABASE_URL=file:/data/saudaai.db \
  MEDIA_DIR=/data/media \
  WEB_DIST=/app/apps/web/dist
# Hosts like Hugging Face run the container as uid 1000, not root.
RUN mkdir -p /data && chown 1000:1000 /data
ENV HOME=/tmp
VOLUME /data
EXPOSE 8787

WORKDIR /app/apps/server
CMD ["sh", "-c", "./node_modules/.bin/tsx scripts/seed.ts && ./node_modules/.bin/tsx src/index.ts"]
