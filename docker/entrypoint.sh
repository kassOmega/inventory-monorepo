#!/bin/sh
# Entrypoint for the combined API + frontend image.
#
#   1. start the NestJS API on BACKEND_PORT (default 3000)
#   2. wait until it accepts connections
#   3. start the Next.js standalone server on PORT (default 3001, published)
#
# Next.js proxies /api/* to the backend (baked in at build time), so the
# backend port never needs to be exposed outside the container.
set -eu

# Docker sets HOSTNAME to the container id, which is NOT a bindable address,
# so always override it for the Next.js server.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3001}"
export BACKEND_PORT="${BACKEND_PORT:-3000}"
export UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"

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

start_backend() {
  cd /app/backend
  # `nest build` emits dist/main.js when only src/ is compiled for tsc, but
  # dist/src/main.js if anything else gets pulled into the program root.
  entry="dist/main.js"
  [ -f "$entry" ] || entry="dist/src/main.js"
  echo "[entrypoint] starting API on :$BACKEND_PORT ($entry)"
  node "$entry" &
  BACKEND_PID=$!
}

start_frontend() {
  cd /app/frontend
  echo "[entrypoint] starting frontend on :$PORT"
  node server.js &
  FRONTEND_PID=$!
}

wait_for_backend() {
  # Nest has no /health route; hitting / is enough to know the server is bound.
  node -e '
    const port = process.env.BACKEND_PORT || 3000;
    const url = `http://127.0.0.1:${port}/`;
    const deadline = Date.now() + 90_000;
    const tick = async () => {
      if (Date.now() > deadline) {
        console.error(`[entrypoint] API did not answer on ${url} within 90s`);
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

start_backend
wait_for_backend
start_frontend

# Exit (and let the trap kill the sibling) as soon as either process dies, so
# Docker restarts the container instead of leaving it half-alive.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 2
done

echo "[entrypoint] a process exited; stopping the other"
terminate
