#!/usr/bin/env bash
# Checks the host ports in setup/docker-compose.yml against what uses them:
#  - every published port has the same host and container number
#    (the UI playgrounds call the gateway on the container port, so the numbers must match)
#  - every localhost:<port> in the lab markdown is published
#  - every service that publishes ports has `ports: !reset []` in e2e/compose.e2e.yaml,
#    so parallel e2e runs do not clash
#  - README.md names every published port
set -euo pipefail
cd "$(dirname "$0")/.."
compose=setup/docker-compose.yml
override=e2e/compose.e2e.yaml
[ -f "$compose" ] || { echo "missing $compose" >&2; exit 1; }

# "<service> <host>:<container>" for each published port.
published=$(awk '
  /^  [a-z0-9-]+:$/ { svc = substr($1, 1, length($1) - 1); inports = 0; next }
  /^    ports:/ { inports = 1; next }
  /^    [a-z]/ { inports = 0 }
  inports && match($0, /"[0-9]+:[0-9]+"/) { print svc, substr($0, RSTART + 1, RLENGTH - 2) }
' "$compose")

fail=0
err() { echo "$1" >&2; fail=1; }

while read -r svc p; do
  host=${p%%:*}; ctr=${p##*:}
  [ "$host" = "$ctr" ] || err "$compose: $svc publishes $p; host and container port must match"
done <<<"$published"

ports=$(awk '{ split($2, a, ":"); print a[1] }' <<<"$published" | sort -u)

for want in $(cat labs/*/*.md 001-*.md | grep -oE 'localhost:[0-9]+' | cut -d: -f2 | sort -u); do
  grep -qx "$want" <<<"$ports" || err "$compose: a lab uses localhost:$want, but no service publishes $want:$want"
done

for svc in $(awk '{ print $1 }' <<<"$published" | sort -u); do
  awk -v s="  $svc:" '$0 == s { f = 1; next } /^  [a-z0-9-]+:$/ { f = 0 } f && /ports: !reset \[\]/ { found = 1 } END { exit !found }' "$override" \
    || err "$override: $svc publishes ports but has no 'ports: !reset []'"
done

for p in $ports; do
  grep -q "\`$p\`" README.md || err "README.md: port $p is published but not listed"
done

exit $fail
