#!/bin/sh
# Entrypoint for the combined API + frontend image.
#
#   1. apply the Prisma schema with `prisma migrate deploy` (falls back to
#      `db push` once when no migration tracking table exists). SKIP_MIGRATIONS=1
#      skips this. RUN_BACKFILLS=1 also applies the idempotent data backfills.
#   2. start the NestJS API on BACKEND_PORT (default 3000)
#   3. wait until it accepts connections (when the frontend is also started)
#   4. start the Next.js standalone server on PORT (default 3001, published)
#
# DEPLOYMENT_TARGET may be `combined` (default), `backend`, or `frontend`.
# With the default, the script auto-detects which app artifacts are present so
# the same entrypoint works for the combined image and split deployments.
set -eu

# Docker sets HOSTNAME to the container id, which is NOT a bindable address,
# so always override it for the Next.js server.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3001}"
export BACKEND_PORT="${BACKEND_PORT:-3000}"
export UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"
export DEPLOYMENT_TARGET="${DEPLOYMENT_TARGET:-combined}"

FRONTEND_PID=""
BACKEND_PID=""

terminate() {
  trap - TERM INT
  echo "[entrypoint] shutting down..."
  [ -n "$FRONTEND_PID" ] && kill -TERM "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill -TERM "$BACKEND_PID" 2>/dev/null || true
  wait
  exit 0
}
trap terminate TERM INT

# Apply schema changes before the API starts. A failure is fatal: serving
# traffic against a mismatched schema corrupts data, and the platform restarting
# the container is the correct response.
#
# Strategy: run `prisma migrate deploy` (the committed migrations, applied
# exactly once, tracked in `_prisma_migrations`). Databases that were previously
# managed with `db push` never recorded a migration baseline, so `migrate
# deploy` would try to replay every migration from scratch and fail. For those
# legacy databases we detect the absence of `_prisma_migrations` and fall back
# to `db push`, which makes the live schema match schema.prisma without data
# loss (the Car Wash tables are created, not dropped).
#
# Set SKIP_MIGRATIONS=1 to run the image without touching the schema, e.g. when
# schema changes are applied by a separate deploy step or by a single replica.
run_migrations() {
  if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
    echo "[entrypoint] SKIP_MIGRATIONS=1 - not applying schema changes"
    return 0
  fi
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] DATABASE_URL is not set - cannot apply schema changes" >&2
    exit 1
  fi
  cd /app/backend

  # A database is "migration-managed" if the tracking table already exists.
  # A fresh or previously `db push`-managed database has no tracking table; for
  # those we baseline with `db push` so the live schema matches schema.prisma
  # (creating the Car Wash tables without dropping data). Once the tracking
  # table exists, all subsequent runs are exact `migrate deploy`.
  has_migration_table="$(node - <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT to_regclass('public.\"_prisma_migrations\"') IS NOT NULL AS present",
    );
    process.stdout.write(rows?.[0]?.present ? '1' : '0');
  } catch {
    process.stdout.write('0');
  } finally {
    await prisma.$disconnect();
  }
})();
NODE
)"

  if [ "$has_migration_table" = "1" ]; then
    echo "[entrypoint] applying migrations with prisma migrate deploy"
    # --no-install: never reach for the network, only the local CLI baked into
    # the image (prisma is a runtime dependency, see package.json).
    if ! npx --no-install prisma migrate deploy; then
      echo "[entrypoint] prisma migrate deploy failed - refusing to start the API" >&2
      exit 1
    fi
  else
    echo "[entrypoint] no _prisma_migrations table - baselining schema with prisma db push"
    if ! npx --no-install prisma db push --accept-data-loss; then
      echo "[entrypoint] prisma db push failed - refusing to start the API" >&2
      exit 1
    fi
  fi

  # Role-permission reconciliation is idempotent and cheap, and keeps the menu
  # consistent with each role's real permissions (a stale grant would otherwise
  # show menu items the role can no longer use). Always reconcile role perms.
  for script in \
    backfill-hospitality-role-permissions \
    backfill-customer-permissions \
    backfill-carwash-role-permissions \
    backfill-carwash-permission-prune; do
    file="dist/prisma/${script}.js"
    if [ -f "$file" ]; then
      echo "[entrypoint] reconciling roles -> ${script}"
      node "$file" || {
        echo "[entrypoint] backfill ${script} failed - refusing to start the API" >&2
        exit 1
      }
    fi
  done

  # Heavier data backfills (default seed data). NOT run by default so container
  # starts stay fast; set RUN_BACKFILLS=1 for the deploy that introduces new
  # default data. Each script is safe to re-run.
  if [ "${RUN_BACKFILLS:-0}" = "1" ]; then
    echo "[entrypoint] RUN_BACKFILLS=1 - applying idempotent data backfills"
    for script in \
      backfill-guest-id-types \
      backfill-room-charges \
      backfill-carwash-vehicle-types \
      backfill-carwash-wash-types; do
      file="dist/prisma/${script}.js"
      if [ -f "$file" ]; then
        echo "[entrypoint]   -> ${script}"
        node "$file" || {
          echo "[entrypoint] backfill ${script} failed - refusing to start the API" >&2
          exit 1
        }
      else
        echo "[entrypoint]   -> ${script} (skipped: $file not found)"
      fi
    done
  fi
}

start_backend() {
  cd /app/backend
  run_migrations
  # `nest build` emits dist/main.js when only src/ is compiled for tsc, but
  # dist/src/main.js if anything else gets pulled into the program root.
  entry="dist/main.js"
  [ -f "$entry" ] || entry="dist/src/main.js"
  if [ ! -f "$entry" ]; then
    echo "[entrypoint] backend entrypoint not found (looked for dist/main.js and dist/src/main.js)" >&2
    exit 1
  fi
  echo "[entrypoint] starting API on :$BACKEND_PORT ($entry)"
  # Nest reads process.env.PORT in src/main.ts. Keep the public/frontend PORT
  # value untouched and override PORT only for the backend child process.
  PORT="$BACKEND_PORT" node "$entry" &
  BACKEND_PID=$!
}

start_frontend() {
  cd /app/frontend
  entry="server.js"
  [ -f "$entry" ] || entry=".next/standalone/server.js"
  if [ ! -f "$entry" ]; then
    echo "[entrypoint] frontend entrypoint not found (looked for server.js and .next/standalone/server.js)" >&2
    exit 1
  fi
  echo "[entrypoint] starting frontend on :$PORT ($entry)"
  node "$entry" &
  FRONTEND_PID=$!
}

wait_for_backend() {
  # Nest has no /health route; hitting / is enough to know the server is bound.
  node -e '
    const port = process.env.BACKEND_PORT || 3000;
    const url = `http://127.0.0.1:${port}/`;
    const deadline = Date.now() + 10_000;
    const tick = async () => {
      if (Date.now() > deadline) {
        console.error(`[entrypoint] API did not answer on ${url} within 10s`);
        console.error(`[entrypoint] check DATABASE_URL and the API log above`);
        process.exit(1);
      }
      try {
        await fetch(url);
        process.exit(0);
      } catch {
        setTimeout(tick, 500);
      }
    };
    tick();
  '
}

case "$DEPLOYMENT_TARGET" in
  combined)
    if [ -d /app/backend ]; then
      start_backend
    fi
    if [ -d /app/frontend ]; then
      [ -n "$BACKEND_PID" ] && wait_for_backend
      start_frontend
    fi
    ;;
  backend)
    start_backend
    ;;
  frontend)
    start_frontend
    ;;
  *)
    echo "[entrypoint] unknown DEPLOYMENT_TARGET=$DEPLOYMENT_TARGET (expected combined, backend, or frontend)" >&2
    exit 1
    ;;
esac

if [ -z "$BACKEND_PID" ] && [ -z "$FRONTEND_PID" ]; then
  echo "[entrypoint] no app artifacts found to start" >&2
  exit 1
fi

# Exit as soon as a child process dies, so Docker restarts the container instead
# of leaving it half-alive. In single-app deployments this simply follows the
# only child process.
while :; do
  if [ -n "$BACKEND_PID" ] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[entrypoint] backend exited; stopping"
    terminate
  fi
  if [ -n "$FRONTEND_PID" ] && ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "[entrypoint] frontend exited; stopping"
    terminate
  fi
  sleep 2
done
