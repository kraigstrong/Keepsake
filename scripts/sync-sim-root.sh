#!/usr/bin/env bash
# Dev-only: mirrors the working tree (uncommitted edits included) into a
# directory with no .env files and no credentials, for
# scripts/run-sim-pair.sh to serve simulators from. See that script for
# why. node_modules is linked, not copied.
#
# Usage: scripts/sync-sim-root.sh <destination>

set -euo pipefail

dest="${1:?usage: sync-sim-root.sh <destination>}"
root="$(cd "$(dirname "$0")/.." && pwd)"

case "$dest" in
  "$root" | "$root"/*)
    echo "Refusing: the copy must live outside the repo (Jest and Metro would crawl it)." >&2
    exit 1
    ;;
esac

mkdir -p "$dest"
# The *.env files at the root are 1Password FIFOs; never read them here.
rsync -a --delete \
  --exclude '/.git' \
  --exclude '/node_modules' \
  --exclude '/ios' \
  --exclude '/android' \
  --exclude '/.expo' \
  --exclude '/coverage' \
  --exclude '/supabase/.temp' \
  --exclude '/.env*' \
  --exclude '/*.env' \
  "$root/" "$dest/"
ln -sfn "$root/node_modules" "$dest/node_modules"

if ls -a "$dest" | grep -qE '^\.env|\.env$'; then
  echo "Refusing: an env file reached $dest." >&2
  exit 1
fi
