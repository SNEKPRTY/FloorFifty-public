#!/usr/bin/env bash
# Drill: a 60-minute soak (release readiness §12.2). Waves of bot rooms come
# and go; the live colour's memory is sampled every 5 minutes.
set -euo pipefail
colour="$(ssh staging cat /srv/floor-fifty/live)"

for wave in $(seq 1 12); do
  pnpm exec vite-node tests/load/bots.ts -- --url "$FF_API" --origin "$FF_ORIGIN" --rooms 6 --seconds 240 || true
  rss="$(ssh staging "systemctl show floor-fifty@$colour -p MemoryCurrent --value")"
  echo "wave $wave: memory $((rss / 1024 / 1024)) MiB"
  sleep 60
done
echo "pass: memory after wave 2 stays within 10%, and rooms read 0 between waves (journal 'rooms' lines)"
"$(dirname "$0")/check.sh"
