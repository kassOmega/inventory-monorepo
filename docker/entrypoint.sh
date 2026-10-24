#!/bin/sh
# Entrypoint for the combined API + frontend image.
#
#   1. apply the Prisma schema with `prisma db push` (idempotent; default) or
#      `prisma migrate deploy` when SCHEMA_STRATEGY=migrate. SKIP_MIGRATIONS=1
#      skips this. Committed data backfills are replayed best-effort.
#   2. start the NestJS API on BACKEND_PORT (default 3000)
#   3. wait until it accepts connections (when the frontend is also started)
#   4. start the Next.js standalone server on PORT (default 3001, published)
#
# Startup failures are written to STATUS_FILE (default
# /app/frontend/public/startup.json) and rendered by the frontend at /status, so
# a crash-loop shows its cause in the browser instead of a bare 502.
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

# The frontend renders this file at /status so a crashed backend (and the 502
# it causes) can be diagnosed from the browser without reading container logs.
STATUS_FILE="${STATUS_FILE:-/app/frontend/public/startup.json}"
export STATUS_FILE

# Root-cause error captured while the startup stages run. It is re-emitted as
# the final status once the frontend is up so the browser keeps showing the
# real failure instead of the last (healthy) stage that wrote to the file.
STARTUP_ERROR=""

# Which schema path was taken ("prisma migrate deploy" vs "prisma db push"),
# reported on the /status page so the prod deployment can be identified.
MIGRATION_PATH=""

write_status() {
  # write_status <stage> <ok:0|1> <error>  -> best-effort, never fatal
  stage="$1"
  ok="$2"
  error="$3"
  STAGE="$stage" OK="$ok" ERROR="$error" node -e '
    const fs = require("fs");
    const path = require("path");
    const file = process.env.STATUS_FILE;
    const data = {
      stage: process.env.STAGE,
      ok: process.env.OK === "1",
      error: process.env.ERROR || "",
      time: new Date().toISOString(),
    };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    } catch (e) {
      // the status file must never take the container down
    }
  ' 2>/dev/null || true
}

# Return the error already recorded in the status file (only when it marks a
# failure), so a later generic message does not clobber a specific one written
# by the backend itself (e.g. a short JWT_SECRET).
read_status_error() {
  node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(process.env.STATUS_FILE, "utf8"));
      process.stdout.write(data && data.ok === false && data.error ? data.error : "");
    } catch (e) {
      process.stdout.write("");
    }
  ' 2>/dev/null || true
}

# Print the name of the most recently failed migration (finished_at IS NULL),
# or nothing when none is recorded. Must run from /app/backend.
find_failed_migration() {
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
  printf '%s' "$failed"
}

FRONTEND_PID=""
BACKEND_PID=""

terminate() {
  trap - TERM INT
  echo "[entrypoint] shutting down..."
  [ -n "$FRONTEND_PID" ] && kill -TERM "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill -TERM "$BACKEND_PID" 2>/dev/null || true
  wait || true
  exit 0
}
trap terminate TERM INT

# Apply schema changes before the API starts. A failure keeps the backend down
# (never serve traffic against a mismatched schema — that corrupts data), but
# the frontend still starts and renders /status with the exact error so the
# cause is visible in the browser without reading container logs.
#
# Strategy: `prisma db push` is the default and authoritative schema step. The
# committed migration history is incomplete (many models were created by an
# earlier `db push` and never got a migration), so `migrate deploy` cannot build
# the schema from scratch and can collide with an already-pushed schema. `db
# push` is idempotent, always reconciles the live schema to schema.prisma, and
# cannot hit that collision class.
#
# Set SCHEMA_STRATEGY=migrate to use the tracked `prisma migrate deploy` path
# instead (only for databases whose migration history is complete).
#
# Set SKIP_MIGRATIONS=1 to run the image without touching the schema, e.g. when
# schema changes are applied by a separate deploy step or by a single replica.
run_migrations() {
  if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
    echo "[entrypoint] SKIP_MIGRATIONS=1 - not applying schema changes"
    MIGRATION_PATH="skipped"
    write_status "migrations:skipped" "1" ""
    return 0
  fi
  write_status "migrations" "1" ""
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] DATABASE_URL is not set - cannot apply schema changes" >&2
    write_status "migrations" "0" "DATABASE_URL is not set - cannot apply schema changes"
    STARTUP_ERROR="DATABASE_URL is not set - cannot apply schema changes"
    return 1
  fi
  cd /app/backend

  # The tracking table only matters for SCHEMA_STRATEGY=migrate. The default
  # (`db push`) reconciles schema.prisma directly regardless of tracking state.
  # A database is "migration-managed" if the tracking table already exists;
  # a fresh or previously `db push`-managed database has no tracking table.
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

  if [ "$has_migration_table" = "1" ] && [ "${SCHEMA_STRATEGY:-dbpush}" = "migrate" ]; then
    MIGRATION_PATH="prisma migrate deploy"
    echo "[entrypoint] applying migrations with prisma migrate deploy (SCHEMA_STRATEGY=migrate)"
    # --no-install: never reach for the network, only the local CLI baked into
    # the image (prisma is a runtime dependency, see package.json).
    if ! npx --no-install prisma migrate deploy; then
      # A failed migration leaves a row in _prisma_migrations and makes
      # `migrate deploy` refuse to proceed (P3009) forever. The migrations are
      # written to be idempotent, so re-running the SQL is safe; but Prisma will
      # not retry a migration it records as failed. Auto-resolve failed
      # migrations one at a time (re-apply the idempotent SQL, mark applied),
      # then retry, so a redeploy can heal itself without manual DB access.
      # Looping matters when a legacy `db push` schema collides with more than
      # one non-idempotent migration.
      echo "[entrypoint] migrate deploy failed - attempting to auto-resolve failed migrations" >&2
      attempt=0
      migrations_ok=0
      while [ "$attempt" -lt 25 ]; do
        attempt=$((attempt + 1))
        failed="$(find_failed_migration)"
        if [ -z "$failed" ]; then
          echo "[entrypoint] no failed migration detected - refusing to start the API" >&2
          break
        fi
        echo "[entrypoint] auto-resolving failed migration ($attempt): $failed" >&2
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
        echo "[entrypoint] retrying prisma migrate deploy (attempt $attempt)"
        if npx --no-install prisma migrate deploy; then
          migrations_ok=1
          break
        fi
      done
      if [ "$migrations_ok" != "1" ]; then
        echo "[entrypoint] prisma migrate deploy still failing - refusing to start the API" >&2
        write_status "migrations" "0" "prisma migrate deploy still failing - refusing to start the API"
        STARTUP_ERROR="prisma migrate deploy still failing - refusing to start the API"
        return 1
      fi
    fi
  else
    MIGRATION_PATH="prisma db push"
    echo "[entrypoint] syncing schema with prisma db push (SCHEMA_STRATEGY=${SCHEMA_STRATEGY:-dbpush})"
    if ! npx --no-install prisma db push --accept-data-loss; then
      echo "[entrypoint] prisma db push failed - refusing to start the API" >&2
      write_status "migrations" "0" "prisma db push failed - refusing to start the API"
      STARTUP_ERROR="prisma db push failed - refusing to start the API"
      return 1
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

  # Multi-unit rollout: `db push` creates the schema but does not execute the
  # data statements in committed migrations. This backfill is idempotent and is
  # also safe to re-run after `migrate deploy` or when no legacy rows exist.
  if [ -f dist/prisma/backfill-product-units.js ]; then
    echo "[entrypoint] backfilling existing product unit data"
    if ! node dist/prisma/backfill-product-units.js; then
      echo "[entrypoint] WARNING: product unit backfill failed; continuing (idempotent, safe to re-run)" >&2
    fi
  fi

  write_status "migrations:${MIGRATION_PATH:-unknown}" "1" ""
}

start_backend() {
  cd /app/backend
  if ! run_migrations; then
    echo "[entrypoint] schema step failed - backend stays down, frontend will show /status" >&2
    write_status "backend" "0" "${STARTUP_ERROR:-schema step failed}"
    return 1
  fi
  # `nest build` emits dist/main.js when only src/ is compiled for tsc, but
  # dist/src/main.js if anything else gets pulled into the program root.
  entry="dist/main.js"
  [ -f "$entry" ] || entry="dist/src/main.js"
  if [ ! -f "$entry" ]; then
    echo "[entrypoint] backend entrypoint not found (looked for dist/main.js and dist/src/main.js)" >&2
    write_status "backend" "0" "backend entrypoint not found (looked for dist/main.js and dist/src/main.js)"
    STARTUP_ERROR="backend entrypoint not found (looked for dist/main.js and dist/src/main.js)"
    return 1
  fi
  echo "[entrypoint] starting API on :$BACKEND_PORT ($entry)"
  # Nest reads process.env.PORT in src/main.ts. Keep the public/frontend PORT
  # value untouched and override PORT only for the backend child process.
  PORT="$BACKEND_PORT" node "$entry" &
  BACKEND_PID=$!
  write_status "backend" "1" ""
}

start_frontend() {
  cd /app/frontend
  entry="server.js"
  [ -f "$entry" ] || entry=".next/standalone/server.js"
  if [ ! -f "$entry" ]; then
    echo "[entrypoint] frontend entrypoint not found (looked for server.js and .next/standalone/server.js)" >&2
    write_status "frontend" "0" "frontend entrypoint not found (looked for server.js and .next/standalone/server.js)"
    STARTUP_ERROR="frontend entrypoint not found (looked for server.js and .next/standalone/server.js)"
    return 1
  fi
  echo "[entrypoint] starting frontend on :$PORT ($entry)"
  node "$entry" &
  FRONTEND_PID=$!
  write_status "frontend" "1" ""
}

wait_for_backend() {
  # Nest now exposes GET /health (app.controller.ts). Hitting it means the server
  # is bound and accepting connections, independent of DB / upstream services.
  if node -e '
    const port = process.env.BACKEND_PORT || 3000;
    const url = `http://127.0.0.1:${port}/health`;
    const deadline = Date.now() + 10_000;
    const tick = async () => {
      if (Date.now() > deadline) {
        console.error(`[entrypoint] API did not answer on ${url} within 10s`);
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
  '; then
    write_status "backend_wait" "1" ""
    return 0
  fi

  # The backend may have written a specific boot failure (e.g. JWT_SECRET too
  # short) before dying. Preserve that root cause instead of overwriting it
  # with a generic "did not answer" message.
  existing="$(read_status_error)"
  if [ -n "$existing" ]; then
    write_status "backend_wait" "0" "$existing"
    STARTUP_ERROR="${STARTUP_ERROR:-$existing}"
  else
    write_status "backend_wait" "0" "backend did not answer /health within 10s (check DATABASE_URL and JWT_SECRET)"
    STARTUP_ERROR="${STARTUP_ERROR:-backend did not answer /health within 10s (check DATABASE_URL and JWT_SECRET)}"
  fi
  return 1
}

case "$DEPLOYMENT_TARGET" in
  combined)
    if [ -d /app/backend ]; then
      start_backend || true
    fi
    if [ -d /app/frontend ]; then
      if [ -n "$BACKEND_PID" ]; then
        wait_for_backend || true
      fi
      start_frontend || true
    fi
    ;;
  backend)
    start_backend || true
    ;;
  frontend)
    start_frontend || true
    ;;
  *)
    echo "[entrypoint] unknown DEPLOYMENT_TARGET=$DEPLOYMENT_TARGET (expected combined, backend, or frontend)" >&2
    write_status "startup" "0" "unknown DEPLOYMENT_TARGET=$DEPLOYMENT_TARGET (expected combined, backend, or frontend)"
    exit 1
    ;;
esac

if [ -z "$BACKEND_PID" ] && [ -z "$FRONTEND_PID" ]; then
  echo "[entrypoint] no app processes started - nothing to supervise" >&2
  if [ -n "$STARTUP_ERROR" ]; then
    write_status "degraded" "0" "$STARTUP_ERROR"
  else
    write_status "startup" "0" "no app artifacts found to start"
  fi
  exit 1
fi

# Emit the final, human-visible status: if a startup stage failed, keep that
# error; otherwise report the system ready. This runs after start_frontend so
# the browser always sees the root cause even though the frontend itself is up.
if [ -n "$STARTUP_ERROR" ]; then
  write_status "degraded" "0" "$STARTUP_ERROR"
else
  write_status "ready:${MIGRATION_PATH:-no-backend}" "1" ""
fi

# Keep the frontend alive even if the backend dies: the browser must be able to
# show /status instead of getting a bare OpenResty 502. Only terminate when the
# frontend itself exits (or the container receives TERM/INT).
while :; do
  if [ -n "$BACKEND_PID" ] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[entrypoint] backend exited; frontend stays up to serve /status" >&2
    existing="$(read_status_error)"
    if [ -n "$existing" ]; then
      write_status "backend" "0" "$existing"
    else
      write_status "backend" "0" "backend process exited unexpectedly"
    fi
    BACKEND_PID=""
  fi
  if [ -n "$FRONTEND_PID" ] && ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "[entrypoint] frontend exited; stopping" >&2
    write_status "frontend" "0" "frontend process exited unexpectedly"
    terminate
  fi
  sleep 2
done
