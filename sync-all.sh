#!/usr/bin/env bash
# sync-all — keep the monorepo mirror and the two standalone repos in sync.
#
#   ./sync-all.sh             sync everything: push the standalone repos (if they
#                             are ahead), mirror both working trees into this
#                             monorepo, then commit + push the monorepo.
#   ./sync-all.sh --dry-run   report what would happen and change nothing.
#
# The standalone checkouts are the source of truth; this monorepo is a snapshot
# mirror of them. Override the checkout locations with FRONTEND_DIR / BACKEND_DIR
# if you keep them somewhere else on another machine:
#
#   FRONTEND_DIR=~/code/frontend BACKEND_DIR=~/code/backend ./sync-all.sh
#
# NOTE: the standalone GitHub repos were recreated as unrelated single-commit
# snapshots, so their histories can diverge from the local checkouts. When they
# do, this script force-pushes with --force-with-lease (never a bare --force), so
# it still aborts if someone else pushed in the meantime.
set -euo pipefail

MONOREPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="${FRONTEND_DIR:-/Users/kass/Documents/projects/inventory/frontend}"
BACKEND_DIR="${BACKEND_DIR:-/Users/kass/Documents/projects/inventory/inventory-backend}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

say() { printf '\033[1;34m[sync-all]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[sync-all]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[sync-all]\033[0m %s\n' "$*" >&2; exit 1; }
run() { if ((DRY_RUN)); then say "would run: $*"; else "$@"; fi; }

# Push the standalone repo to GitHub when it has commits the remote lacks.
sync_standalone() {
  local repo="$1" label="$2" local_sha remote_sha
  [[ -d "$repo/.git" ]] || die "$label checkout not found at $repo"

  local dirty
  dirty="$(git -C "$repo" status --porcelain -uall)"
  [[ -z "$dirty" ]] || die "$label has uncommitted changes — commit them first:
$dirty"

  say "checking $label"
  run git -C "$repo" fetch --quiet "$REMOTE"

  local_sha="$(git -C "$repo" rev-parse "$BRANCH")"
  remote_sha="$(git -C "$repo" rev-parse "$REMOTE/$BRANCH" 2>/dev/null || true)"

  if [[ -n "$remote_sha" && "$local_sha" == "$remote_sha" ]]; then
    say "$label already matches $REMOTE/$BRANCH ($local_sha)"
    return
  fi

  if [[ -n "$remote_sha" ]] && git -C "$repo" merge-base --is-ancestor "$remote_sha" "$local_sha"; then
    say "pushing $label $local_sha -> $REMOTE/$BRANCH"
    run git -C "$repo" push "$REMOTE" "$BRANCH"
  else
    warn "$label history diverged from $REMOTE/$BRANCH — forcing with lease"
    run git -C "$repo" push --force-with-lease "$REMOTE" "$BRANCH"
  fi
}

# Copy the tracked files of a standalone repo into its monorepo directory and
# remove anything the standalone repo no longer tracks.
mirror() {
  local repo="$1" sub="$2" path rel
  say "mirroring $(basename "$repo") -> $sub/"
  (cd "$repo" && git ls-files -z | rsync -a --from0 --files-from=- ./ "$MONOREPO_DIR/$sub/")

  while IFS= read -r -d '' path; do
    rel="${path#"$sub"/}"
    if [[ ! -e "$repo/$rel" ]]; then
      run rm -f "$MONOREPO_DIR/$path"
    fi
  done < <(git -C "$MONOREPO_DIR" ls-files -z -- "$sub")
}

sync_standalone "$FRONTEND_DIR" frontend
sync_standalone "$BACKEND_DIR" backend
mirror "$FRONTEND_DIR" frontend
mirror "$BACKEND_DIR" inventory-backend

say "updating the monorepo mirror"
run git -C "$MONOREPO_DIR" add -A
if git -C "$MONOREPO_DIR" diff --cached --quiet; then
  say "monorepo already in sync — nothing to commit"
else
  run git -C "$MONOREPO_DIR" commit -m "sync: mirror standalone frontend & backend"
  run git -C "$MONOREPO_DIR" push "$REMOTE" "$BRANCH"
fi
say "done"
