#!/usr/bin/env bash
# Drill: delay and loss on the staging API's port (release readiness §12.2).
# Usage: netem.sh <delay-ms>   (500, 1000, then 2000). Race two real clients
# while it holds, then press Enter to lift it.
set -euo pipefail
delay="${1:?usage: netem.sh <delay-ms>}"
jitter=$(( delay * 30 / 100 ))
iface="$(ssh staging "ip route get 1.1.1.1 | awk '{for (i=1;i<NF;i++) if (\$i==\"dev\") print \$(i+1)}'")"

ssh staging "sudo tc qdisc add dev $iface root netem delay ${delay}ms ${jitter}ms loss 2%"
trap 'ssh staging "sudo tc qdisc del dev '"$iface"' root" || true' EXIT
echo "netem on $iface: ${delay} ms ±${jitter} ms, 2% loss. Race now; Enter lifts it."
read -r
ssh staging "sudo tc qdisc del dev $iface root"
trap - EXIT
"$(dirname "$0")/check.sh"
