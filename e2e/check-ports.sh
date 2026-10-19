#!/usr/bin/env bash
# Fails if setup/docker-compose.yml publishes a port on a different host number
# than the container number, or misses one of the ports the labs use.
# The UI playgrounds call the gateway on the container port, so the numbers must match.
set -euo pipefail
cd "$(dirname "$0")/.."
compose=setup/docker-compose.yml
[ -f "$compose" ] || { echo "missing $compose" >&2; exit 1; }
ports=$(grep -oE '^\s*-\s*"[0-9]+:[0-9]+"' "$compose" | grep -oE '[0-9]+:[0-9]+')
fail=0
for p in $ports; do
  host=${p%%:*}; ctr=${p##*:}
  if [ "$host" != "$ctr" ]; then echo "port mismatch: $p" >&2; fail=1; fi
done
for want in 15000 4000 4001 8080 8180; do
  echo "$ports" | grep -qx "$want:$want" || { echo "missing port $want:$want" >&2; fail=1; }
done
exit $fail
