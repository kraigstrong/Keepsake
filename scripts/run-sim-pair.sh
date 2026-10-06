#!/usr/bin/env bash
# Dev-only: serves the app to one simulator as one seeded member, against
# LOCAL Supabase. Run once per simulator, each on its own port, after
# scripts/seed-local-group-household.mjs:
#
#   scripts/run-sim-pair.sh Alex 8081
#   scripts/run-sim-pair.sh Blair 8082
#
# then, once each prints "verified", point its simulator's dev client at
# its port:
#
#   xcrun simctl openurl <udid> "exp+keepsake://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
#
# Why a copy of the working tree: in development Expo merges every root
# .env* file over process.env (expo/virtual/env, built in
# @expo/metro-config's transform worker), ignoring EXPO_NO_DOTENV. With
# .env.local present, the app talks to the hosted project whatever the
# shell says. So Metro runs from a synced copy with no .env files and the
# repo's own node_modules, and stays up only if
# scripts/verify-sim-bundle.mjs confirms the served bundle is loopback.
# Re-run scripts/sync-sim-root.sh after editing to pick up changes.

set -euo pipefail

member="${1:?usage: run-sim-pair.sh <Alex|Blair|Casey> <port>}"
port="${2:?usage: run-sim-pair.sh <Alex|Blair|Casey> <port>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
sim_root="${KEEPSAKE_SIM_ROOT:-${TMPDIR:-/tmp}/keepsake-sim-root}"
cd "$root"

status="$(npx supabase status -o env 2>/dev/null)"
api_url="$(printf '%s\n' "$status" | sed -n 's/^API_URL="\(.*\)"$/\1/p')"
publishable_key="$(printf '%s\n' "$status" | sed -n 's/^PUBLISHABLE_KEY="\(.*\)"$/\1/p')"
case "$api_url" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *)
    echo "Refusing: local Supabase isn't running (API_URL='${api_url}')." >&2
    exit 1
    ;;
esac

accounts=supabase/.temp/group-test-accounts
if [[ ! -f "$accounts" ]]; then
  echo "Run scripts/seed-local-group-household.mjs first." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "./$accounts"
set +a

key="$(printf '%s' "$member" | tr '[:lower:]' '[:upper:]')"
email_var="GROUP_TEST_${key}_EMAIL"
password_var="GROUP_TEST_${key}_PASSWORD"
if [[ -z "${!email_var:-}" ]]; then
  echo "No seeded member named ${member}." >&2
  exit 1
fi

"$root/scripts/sync-sim-root.sh" "$sim_root"
cd "$sim_root"

export EXPO_NO_DOTENV=1
export EXPO_PUBLIC_SUPABASE_URL="$api_url"
export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$publishable_key"
export EXPO_PUBLIC_DEV_TEST_EMAIL="${!email_var}"
export EXPO_PUBLIC_DEV_TEST_PASSWORD="${!password_var}"
export TMPDIR="${TMPDIR:-/tmp}/keepsake-sim-${key}"
mkdir -p "$TMPDIR"

npx expo start --dev-client --port "$port" --clear &
metro_pid=$!
trap 'kill "$metro_pid" 2>/dev/null' EXIT INT TERM

until curl -sf "http://127.0.0.1:${port}/status" >/dev/null; do
  if ! kill -0 "$metro_pid" 2>/dev/null; then
    echo "Metro exited before it was ready." >&2
    exit 1
  fi
  sleep 1
done
node "$root/scripts/verify-sim-bundle.mjs" "$port"

trap - EXIT
wait "$metro_pid"
