#!/usr/bin/env bash
# Drill: switch colours under 20 bot rooms (release readiness §12.2).
# Re-activates the live build on the idle colour, which drains the old one.
set -euo pipefail

pnpm exec vite-node tests/load/bots.ts -- --url "$FF_API" --origin "$FF_ORIGIN" --rooms 20 --seconds 420 &
bots=$!
sleep 120
id="$(ssh staging cat /srv/floor-fifty/current)"
echo "activating $id again, onto the idle colour"
ssh staging "sudo /usr/local/lib/floor-fifty/bin/activate $id"
wait "$bots"   # non-zero if any bot got stuck
"$(dirname "$0")/check.sh"
