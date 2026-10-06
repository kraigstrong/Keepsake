#!/usr/bin/env bash
# Dev-only: mirrors the working tree (uncommitted edits included) into a
# directory with no .env files and no credentials, for
# scripts/run-sim-pair.sh to serve simulators from. See that script for
# why. node_modules is linked, not copied.
#
# Usage: scripts/sync-sim-root.sh <destination>

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
# Canonical, so a relative path, `..` or a symlink can't slip a
# destination inside the repo past the check below (Codex, PR #247). The
# destination may not exist yet, so resolve its deepest existing ancestor.
dest="$(node -e '
  const fs = require("fs");
  const path = require("path");
  let existing = path.resolve(process.argv[1]);
  const rest = [];
  while (!fs.existsSync(existing)) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  console.log(path.join(fs.realpathSync(existing), ...rest));
' "${1:?usage: sync-sim-root.sh <destination>}")"

case "$dest" in
  "$root" | "$root"/*)
    echo "Refusing: the copy must live outside the repo (Jest and Metro would crawl it)." >&2
    exit 1
    ;;
esac

# rsync --delete empties whatever it's pointed at, so only ever sync into
# a new or empty directory, or one this script created before (Codex,
# PR #247).
marker=.keepsake-sim-root
if [[ -d "$dest" && ! -f "$dest/$marker" && -n "$(ls -A "$dest")" ]]; then
  echo "Refusing: $dest isn't empty and wasn't created by this script." >&2
  exit 1
fi
mkdir -p "$dest"
touch "$dest/$marker"

# The *.env files at the root are 1Password FIFOs; never read them here.
rsync -a --delete \
  --exclude "/$marker" \
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
