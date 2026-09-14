#!/bin/sh
# Entrypoint for the combined API + frontend image.
#
#   1. sync the Prisma schema with `prisma db push` (unless SKIP_MIGRATIONS=1)
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

# Sync schema changes with Prisma db push before the API starts. A failure is
# fatal: serving traffic against a mismatched schema corrupts data, and the
# platform restarting the container is the correct response.
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
  echo "[entrypoint] syncing schema with prisma db push"
  # --no-install: never reach for the network, only the local CLI baked into
  # the image (prisma is a runtime dependency, see package.json).
  if ! npx --no-install prisma db push --accept-data-loss; then
    echo "[entrypoint] prisma db push failed - refusing to start the API" >&2
    exit 1
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
