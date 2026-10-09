# Plan: speed up the Docker image build (~4 min in GitHub Actions)

## Symptom
`Docker image` (`docker/build-push-action@v6`) in `.github/workflows/docker-publish.yml`
takes ≈4 minutes wall-clock. Most of it is the **frontend (Next.js) production
build**; the rest is two cold `npm ci` installs and the compiler/emit stages.

## Where the time actually goes (from the Dockerfile + repo)
1. **Frontend build — dominant (~2.5–3 min).**
   - `frontend` uses **Next 16** but compiles with **webpack** (`next build --webpack`),
     not Turbopack. Webpack is the slow step (minify + PWA/Workbox + RSC emit).
   - `@ducanh2912/next-pwa` runs a **Workbox** pass over the output (`cacheOnFrontEndNav`,
     precache manifest), adding time and a second write of `.next` (1.1 GB locally).
   - `output: "standalone"` adds a file-tracing pass.
   - The whole `frontend/` tree is `COPY`'d before `npm run build`, so **any
     frontend source change** invalidates the build layer (expected), and nothing
     inside Next is persisting between runs.
2. **Two independent `npm ci` installs** (backend-builder, frontend-builder).
   - Each stage starts from `node:22-bookworm-slim` and installs from scratch.
   - Only the GHA **layer cache** (`cache-from/to: type=gha`) can help; a lockfile
     change busts both.
3. **Backend build (moderate, ~40–60 s).** `nest build` (tsc) + `prisma generate`
   + a second `npm run build:prisma-scripts`, then `npm prune --omit=dev`.
4. **Runtime stage** copy + `apt-get install` (openssl) — small (~10–15 s).
5. **`provenance: true` + `sbom: true`** add an attestation/SBOM pass at the end.

Non-issues (already good): `.dockerignore` exists and excludes `node_modules`,
`.next`, `.git`; `platforms: linux/amd64` only (no QEMU); `cache-from/to: type=gha`
already set; `cancel-in-progress: true` is on.

## Goals
- Cut the ~4 min to roughly **2–2.5 min** on cache hits, without changing runtime
  behavior or the single-image (`frontend + backend`) layout.
- Keep the AMD64-only target and the GHA layer cache.

## Options (least risk first)

### 1. Cache Next's own build artifacts + `node_modules` across runs
Next has no built-in persistent cache for webpack in CI, but two wins are easy:
- **Frontend `npm ci` cache**: mount a BuildKit cache for the npm cache
  (`--mount=type=cache,target=/root/.npm`) so re-installs after a lockfile bump
  are warm. Cheap, no behavior change.
- **`.next/cache`**: mount `--mount=type=cache,target=/app/.next/cache` on the
  frontend build so Next's webpack disk cache (`cacheDirectory`) is reused. Webpack
  5 disk cache can cut rebuild time substantially. (Verify Next 16 with
  `--webpack` honors `.next/cache`; if not, drop this sub-item.)
- Same `--mount=type=cache,target=/root/.npm` for the backend stage.

### 2. Give the runner more CPUs (biggest single lever)
`ubuntu-latest` gives **4 vCPUs**. Next webpack + `nest build` are CPU-bound and
parallelize, so build time scales with cores. Options:
- Use a **larger runner** (`runs-on: ubuntu-latest-8-cores`, or the org's larger
  runner label) — often roughly halves build time. Requires the repo/org to have
  larger runners available (may be a paid add-on).
- Or pin `ubuntu-24.04` and ensure `NEXT_TELEMETRY_DISABLED=1` (already set) and
  no stray parallelism throttling.

### 3. Switch the frontend build to Turbopack (fastest, but riskier)
Next 16 supports `next build` with Turbopack. It is typically **2–4× faster** than
webpack here, but:
- `@ducanh2912/next-pwa` hooks webpack; Turbopack compatibility is uncertain
  (PWA/Workbox). Must verify the service worker + precache manifest still emit.
- Risk of subtle output differences (the reason `--webpack` was chosen in the
  first place — likely a prior Turbopack incompatibility).
- **Do only behind a measurement**: try `next build --turbopack` in a scratch
  branch; keep `--webpack` if PWA output or runtime regresses.

### 4. Trim the build inputs / passes
- **Don't copy the whole repo tree into the frontend stage before build** — keep
  as-is (Next needs the sources), but ensure `public/` and `worker/` only.
- Consider disabling `provenance`/`sbom` if the attestation isn't consumed; it is
  a small but real end-of-build cost. (Keep unless SBOM is required.)
- Skip the **second** `npm run build:prisma-scripts` if those JS scripts aren't
  used in production (only needed for manual `seed:prod:js`). Saves a tsc pass.

### 5. Split jobs / parallelize stages
BuildKit already parallelizes independent stages. Ensure the workflow doesn't
serialize anything unnecessarily; `docker buildx` with gha cache handles this.
No change likely needed, but confirm the frontend and backend stages build
concurrently (they do with `sourceDateEpoch`/default BuildKit).

### 6. Cache `node_modules` as a BuildKit cache mount (faster than layer cache)
Instead of relying on the layer cache for `npm ci`, mount
`--mount=type=cache,target=/app/node_modules` (and `/root/.npm`). This keeps the
download+extract cost low even when `package-lock.json` changes. Trade-off:
correctness requires the cache to be invalidated when the lockfile changes —
BuildKit cache mounts are content-addressed by the mount id, so **key the mount id
by a lockfile hash** (`id=npm-fe-$(sha256sum package-lock.json)`), or keep using
the layer cache for `node_modules` and cache-mount only `~/.npm`.

## Recommended plan (in order)

1. **Measure first.** Add timing to the build so we know the split:
   - `docker/build-push-action` already supports `BUILDKIT_PROGRESS=plain`; add
     `env: BUILDKIT_PROGRESS: plain` to the Build step and read per-step durations
     from the logs (or use `--progress=plain`).
   - Record: frontend `npm ci`, `nest build`, `next build`, prune, runtime.
2. **Add BuildKit cache mounts** (`/root/.npm` in both builder stages; and, if
   Next honors it, `/app/.next/cache` in the frontend stage). Low risk.
3. **Try a larger runner** (`ubuntu-latest-8-cores` if available). Biggest, safest
   win; no Dockerfile changes.
4. **Drop the unused production Prisma-script compile** (`build:prisma-scripts`)
   if the container never runs `seed:prod:js`. Confirm via `docker/entrypoint.sh`.
5. **Evaluate Turbopack** (`next build --turbopack`) in a scratch branch only —
   verify PWA/Workbox output + runtime, then adopt if clean. This is the path to
   the biggest reduction but carries the most risk.
6. **Re-measure** and keep provenance/sbom only if required.

## Verification
- Compare wall-clock before/after for: no-op rebuild (cache hit), a frontend-only
  change, and a backend-only change.
- Confirm the pushed image still serves the app: `docker run` + hit `/` and an
  API route through the Next rewrite; confirm the service worker +
  `public/sw.js`/precache still emit (PWA intact) if Turbopack is tried.
- Confirm image size and layer cache hit rate in the Actions log
  (`CACHED` vs `RUN` lines).

## Expected outcome
- With cache mounts + larger runner (or Turbopack), the build should land around
  **2–2.5 min** (or less with Turbopack) vs the current ~4 min, with no runtime
  behavior change.

## Open questions
1. Are the **larger GitHub runners** available to this repo/org (or willing to
   enable them)? If not, skip step 3.
2. Is `provenance`/`sbom` consumed downstream? If not, drop them (step 6).
3. Is the service worker / PWA a hard requirement that blocks Turbopack? If yes,
   Turbopack stays out and we rely on caches + bigger runner.
4. Does anything run `seed:prod:js` in production? If not, remove the extra
   Prisma-script compile.
