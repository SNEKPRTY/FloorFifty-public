#!/usr/bin/env bash
# The check every drill ends with (release readiness §12.2): the server is
# ready, its rooms have drained back to none, and a fresh room races.
#
# Usage: check.sh   (reads FF_API and FF_ORIGIN)
set -euo pipefail
: "${FF_API:?set FF_API to the staging API}"
: "${FF_ORIGIN:?set FF_ORIGIN to the staging client origin}"

echo "ready:"
curl -fsS "$FF_API/ready"; echo

echo "rooms back to none:"
for _ in $(seq 1 60); do
  rooms="$(ssh staging "journalctl -u 'floor-fifty@*' --since '-2min' -o cat | grep '\"event\":\"rooms\"' | tail -1" || true)"
  echo "  $rooms"
  [[ "$rooms" == *'"live":0'* ]] && break
  sleep 10
done
[[ "$rooms" == *'"live":0'* ]] || { echo "rooms did not drain" >&2; exit 1; }

echo "a fresh room races:"
pnpm exec vite-node tests/load/bots.ts -- --url "$FF_API" --origin "$FF_ORIGIN" --rooms 1 --seconds 90
