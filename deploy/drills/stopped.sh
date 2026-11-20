#!/usr/bin/env bash
# Drill: the server stopped and left stopped (release readiness §12.2).
# While it is down, load the staging client: it shows "cannot start" with
# Try again. Press Enter to bring it back; Try again then recovers.
set -euo pipefail
colour="$(ssh staging cat /srv/floor-fifty/live)"

ssh staging "sudo systemctl stop floor-fifty@$colour"
echo "API now answers: $(curl -s -o /dev/null -w '%{http_code}' "$FF_API/ready") (pass: 502)"
echo "Load the staging client now; Enter restarts the server."
read -r
ssh staging "sudo systemctl start floor-fifty@$colour"
until curl -fsS -m 2 "$FF_API/ready" > /dev/null 2>&1; do sleep 1; done
"$(dirname "$0")/check.sh"
