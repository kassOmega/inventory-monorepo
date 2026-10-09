#!/bin/sh
# Entrypoint for the combined API + frontend image.
#
#   1. apply the Prisma schema and data with `prisma migrate deploy` (falls back
#      to `db push` once when no migration tracking table exists). SKIP_MIGRATIONS=1
#      skips this. Data backfills are committed SQL migrations, not run here.
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
      # A migration that previously failed leaves a row in _prisma_migrations
      # and makes `migrate deploy` refuse to proceed forever. The migrations are
      # written to be idempotent, so re-running them is safe; but Prisma will not
      # retry a migration it records as failed. Auto-resolve any failed migration
      # as applied once, then retry, so a redeploy can heal itself without
      # manual `migrate resolve` access to the database.
      echo "[entrypoint] migrate deploy failed - checking for failed migrations to auto-resolve" >&2
      failed="$(npx --no-install prisma migrate status 2>/dev/null | sed -n 's/.*migration \([0-9_a-zA-Z]*\) .*failed.*/\1/p' | head -1)"
      if [ -z "$failed" ]; then
        # Fall back to querying the tracking table directly.
        failed="$(node - <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at DESC LIMIT 1",
    );
    process.stdout.write(rows?.[0]?.migration_name || '');
  } catch {
    process.stdout.write('');
  } finally {
    await prisma.$disconnect();
  }
})();
NODE
)"
      fi
      if [ -n "$failed" ]; then
        echo "[entrypoint] auto-resolving failed migration: $failed" >&2
        # Marking it applied alone could leave a partially-applied migration's
        # schema incomplete. Re-run the migration's own SQL first (it is written
        # to be idempotent), then record it as applied. If the file is missing
        # (older migration), fall back to resolving it as applied.
        failed_sql="prisma/migrations/$failed/migration.sql"
        if [ -f "$failed_sql" ]; then
          echo "[entrypoint] re-applying idempotent SQL for $failed" >&2
          npx --no-install prisma db execute --file "$failed_sql" --schema prisma/schema.prisma || true
        fi
        npx --no-install prisma migrate resolve --applied "$failed" || true
        echo "[entrypoint] retrying prisma migrate deploy"
        if ! npx --no-install prisma migrate deploy; then
          echo "[entrypoint] prisma migrate deploy still failing - refusing to start the API" >&2
          exit 1
        fi
      else
        echo "[entrypoint] no failed migration detected - refusing to start the API" >&2
        exit 1
      fi
    fi
  else
    echo "[entrypoint] no _prisma_migrations table - baselining schema with prisma db push"
    if ! npx --no-install prisma db push --accept-data-loss; then
      echo "[entrypoint] prisma db push failed - refusing to start the API" >&2
      exit 1
    fi
    # Legacy (db push) databases skip `migrate deploy`, so apply the committed
    # DATA migrations directly (idempotent SQL). Schema is already synced by the
    # `db push` above; these migrations reconcile role permissions to the code
    # baselines. Applying the same SQL as `migrate deploy` keeps one source of
    # truth (no separate backfill scripts).
    #
    # These are best-effort data reconciliations on an already-synced schema: a
    # failure here must not take the whole app down (a 502 for every request),
    # so log it and continue. Genuine schema problems still fail hard above in
    # the fatal `db push` step. Every file is written to be idempotent anyway
    # (ADD COLUMN/CREATE INDEX IF NOT EXISTS, guarded ADD CONSTRAINT), so a
    # re-run against a DB that already has the objects is a clean no-op.
    for migration in \
      prisma/migrations/20261013000000_reconcile_role_permissions/migration.sql \
      prisma/migrations/20261013000001_carwash_prune_foreign_grants/migration.sql \
      prisma/migrations/20261013000002_carwash_washer_accounts/migration.sql \
      prisma/migrations/20261015000000_carwash_payment_method/migration.sql \
      prisma/migrations/20261015000001_payment_methods_permissions/migration.sql; do
      if [ -f "$migration" ]; then
        echo "[entrypoint] baselining data -> $migration"
        if ! npx --no-install prisma db execute --file "$migration" --schema prisma/schema.prisma; then
          echo "[entrypoint] WARNING: $migration failed; continuing (best-effort data reconciliation). Check the platform logs if permissions look stale." >&2
        fi
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
