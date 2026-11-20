#!/usr/bin/env bash
# Drill: the socket and room caps (release readiness §12.2).
# 17 sockets from this address: the 17th is refused. Then rooms to MAX_ROOMS + 1:
# the extra one is refused as SERVER_BUSY.
set -euo pipefail
host="${FF_API#https://}"

out="$(mktemp -d)"
for i in $(seq 1 17); do
  # All at once, each held open for 20 s; each status line goes to its own file.
  ( (printf 'GET /drill HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: %s\r\n\r\n' "$host" "$FF_ORIGIN"; sleep 20) \
    | openssl s_client -quiet -connect "$host:443" -servername "$host" 2>/dev/null | head -1 > "$out/$i" ) &
done
wait
for i in $(seq 1 17); do echo "socket $i: $(tr -d '\r' < "$out/$i")"; done
echo "pass: sixteen read 101, one reads 429. The server's refused lines:"
ssh staging "journalctl -u 'floor-fifty@*' --since '-2min' -o cat | grep '\"limit\":\"sockets\"' | tail -3"

max_rooms="$(ssh staging "grep -oP '^MAX_ROOMS=\K\d+' /etc/floor-fifty/env")"
pnpm exec vite-node tests/load/bots.ts -- --url "$FF_API" --origin "$FF_ORIGIN" --rooms "$((max_rooms + 1))" --seconds 60 || true
echo "the extra room should be refused SERVER_BUSY (above), and logged:"
ssh staging "journalctl -u 'floor-fifty@*' --since '-2min' -o cat | grep '\"limit\":\"busy\"' | tail -1"
"$(dirname "$0")/check.sh"
