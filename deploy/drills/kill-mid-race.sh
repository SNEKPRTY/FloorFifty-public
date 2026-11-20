#!/usr/bin/env bash
# Drill: kill -9 the live colour mid-race (release readiness §12.2).
# Start two real clients in a race on staging first, then run this.
set -euo pipefail
here="$(dirname "$0")"

pnpm exec vite-node tests/load/bots.ts -- --url "$FF_API" --origin "$FF_ORIGIN" --rooms 20 --seconds 240 &
bots=$!
sleep 90
colour="$(ssh staging cat /srv/floor-fifty/live)"
echo "killing floor-fifty@$colour"
ssh staging "sudo systemctl kill -s KILL floor-fifty@$colour"
started="$(date +%s)"
until curl -fsS -m 2 "$FF_API/ready" > /dev/null 2>&1; do sleep 1; done
echo "ready again after $(( $(date +%s) - started )) s (pass: under 10)"
wait "$bots" || true
"$here/check.sh"
