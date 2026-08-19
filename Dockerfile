# syntax=docker/dockerfile:1
#
# TarangOS — single-image build.
# The web SPA is compiled and then served by the API process, so there is one
# container, one port, and no reverse proxy required for a private deployment.

# ---------------------------------------------------------------------------
# 1. Build the frontend
# ---------------------------------------------------------------------------
FROM node:22-alpine AS web-build
WORKDIR /build

COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --fund=false

COPY web/ ./
RUN node scripts/generate-icons.mjs && npm run build

# ---------------------------------------------------------------------------
# 2. Build the server
# ---------------------------------------------------------------------------
FROM node:22-alpine AS server-build
WORKDIR /build

COPY server/package.json server/package-lock.json* ./
COPY server/prisma ./prisma
# DATABASE_URL is only needed so `prisma generate` can resolve the datasource.
ENV DATABASE_URL="file:../../data/tarangos.db"
RUN npm install --no-audit --fund=false

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini wget && \
    addgroup -g 1001 tarang && \
    adduser -D -u 1001 -G tarang tarang

ENV NODE_ENV=production \
    PORT=4517 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    WEB_DIST=/app/web/dist \
    DATABASE_URL="file:/app/data/tarangos.db"

# Runtime deps only. The Prisma CLI is a runtime dependency (not a dev one) so
# `prisma generate` in postinstall succeeds here, and so schema sync on start
# works offline without npx having to fetch anything.
COPY --chown=tarang:tarang server/package.json server/package-lock.json* /app/server/
COPY --chown=tarang:tarang server/prisma /app/server/prisma
WORKDIR /app/server
RUN npm install --omit=dev --no-audit --fund=false && npm cache clean --force

COPY --from=server-build --chown=tarang:tarang /build/dist /app/server/dist
COPY --from=web-build --chown=tarang:tarang /build/dist /app/web/dist

RUN mkdir -p /app/data/backups && chown -R tarang:tarang /app/data

USER tarang
WORKDIR /app/server
EXPOSE 4517
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4517/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# Create or update the SQLite schema on the mounted volume, then start.
CMD ["sh", "-c", "npx --no-install prisma db push --skip-generate || echo '[tarangos] schema sync skipped'; exec node dist/index.js"]
