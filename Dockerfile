# syntax=docker/dockerfile:1
#
# Single image that runs BOTH apps:
#   * NestJS API          -> 127.0.0.1:3000 (internal only)
#   * Next.js frontend    -> 0.0.0.0:$PORT (default 3001, the only published port)
#
# The frontend is built with NEXT_PUBLIC_API_BASE_URL=/api, so all browser API
# calls hit the same origin and are proxied by Next.js rewrites to the backend
# on localhost. One origin => no CORS, no second public port.
#
# Build:
#   docker build -t inventory:local .
# Run:
#   docker run --rm -p 3001:3001 --env-file inventory-backend/.env inventory:local
#
# NOTE: schema changes are applied from docker/entrypoint.sh at container
# start (`prisma db push --accept-data-loss`). Set SKIP_MIGRATIONS=1 to opt out
# and keep applying schema changes as a separate deploy step instead.

# =============================================================================
# 1. Backend (NestJS) build
# =============================================================================
FROM node:22-bookworm-slim AS backend-builder

WORKDIR /app

# python3/make/g++ let node-gyp build native modules (bcrypt) from source when
# no prebuilt binary matches the container's Node version / libc.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY inventory-backend/package.json inventory-backend/package-lock.json ./
RUN npm ci

# Only the schema: `prisma generate` needs it, and copying the .ts scripts in
# prisma/ would widen tsc's inferred rootDir to the repo root, emitting
# dist/src/main.js instead of dist/main.js.
COPY inventory-backend/prisma/schema.prisma ./prisma/schema.prisma
# Keep migrations in the image for operators who inspect/debug the schema, even
# though the runtime entrypoint now uses `prisma db push`.
COPY inventory-backend/prisma/migrations ./prisma/migrations
# `prisma generate` does not connect to the database, but the datasource URL
# must be resolvable, so give it a throwaway value at build time.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
RUN npx prisma generate

COPY inventory-backend/nest-cli.json inventory-backend/tsconfig.json inventory-backend/tsconfig.build.json inventory-backend/tsconfig.scripts.json ./
COPY inventory-backend/src ./src
# Deliberately `nest build` and not `npm run build`: that script runs
# `prisma db push` + backfill scripts against a live database. -> dist/main.js
RUN npx nest build

# Compile Prisma seed/backfill scripts to JS so production containers can run
# them manually without ts-node/devDependencies, e.g.:
#   cd /app/backend && npm run seed:prod:js
COPY inventory-backend/prisma/*.ts ./prisma/
RUN npm run build:prisma-scripts \
  && npm prune --omit=dev

# =============================================================================
# 2. Frontend (Next.js) build
# =============================================================================
FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
# Must match the internal port the backend listens on in the runtime stage.
ARG API_PROXY_TARGET=http://127.0.0.1:3000

ENV NEXT_OUTPUT_STANDALONE=true \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY} \
    API_PROXY_TARGET=${API_PROXY_TARGET}

RUN npm run build

# =============================================================================
# 3. Runtime
# =============================================================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOME=/home/node \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    BACKEND_PORT=3000 \
    UPLOAD_DIR=/app/uploads

# Prisma's query engine needs libssl at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# --- backend ----------------------------------------------------------------
# `prisma` is a runtime dependency (not dev), so the CLI and its schema engine
# survive `npm prune --omit=dev` and are available to the entrypoint.
COPY --from=backend-builder --chown=node:node /app/node_modules /app/backend/node_modules
COPY --from=backend-builder --chown=node:node /app/dist /app/backend/dist
COPY --from=backend-builder --chown=node:node /app/package.json /app/backend/package.json
# schema.prisma is read by `prisma db push` in the entrypoint.
COPY --from=backend-builder --chown=node:node /app/prisma /app/backend/prisma

# --- frontend (standalone server + static assets + PWA output) --------------
COPY --from=frontend-builder --chown=node:node /app/.next/standalone /app/frontend
COPY --from=frontend-builder --chown=node:node /app/.next/static /app/frontend/.next/static
COPY --from=frontend-builder --chown=node:node /app/public /app/frontend/public

# Uploaded KYC documents / images. Mount a volume here to survive restarts.
RUN mkdir -p /app/uploads && chown node:node /app /app/uploads

COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER node

EXPOSE 3001

# Schema sync runs before the API binds, and a first boot against an existing
# database can take a while, so give the start period enough headroom. Failures
# during --start-period do not count against --retries.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/backend
CMD ["/usr/local/bin/entrypoint.sh"]
