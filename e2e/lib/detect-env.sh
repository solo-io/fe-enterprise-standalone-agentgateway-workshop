#!/usr/bin/env bash
# detect-env.sh: probe the host and write ${E2E_WORK_ROOT:-e2e/.work}/env.json, then print the same as key: value lines.
#
# Exit 0 when docker, docker compose, python3, jq, setup/.env and a working OPENAI_API_KEY are all present.
# Exit 2 otherwise, with one line per missing item. E2E_CURL replaces curl (tests).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_ROOT="${E2E_WORK_ROOT:-$ROOT/e2e/.work}"
PW_IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble"
CURL="${E2E_CURL:-curl}"

# shellcheck source=keys.sh
source "$ROOT/e2e/lib/keys.sh"

# run_capped <seconds> <command...>: exit status of the command, 124 when it ran too long.
run_capped() {
  local secs="$1"; shift
  if command -v timeout >/dev/null; then timeout "$secs" "$@" >/dev/null 2>&1; return $?; fi
  "$@" >/dev/null 2>&1 &
  local pid=$! i=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$i" -ge $((secs * 5)) ]; then kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 124; fi
    sleep 0.2; i=$((i + 1))
  done
  wait "$pid"
}

json_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

# docker and compose
docker_v=absent; compose_v=absent; image="pull needed"; projects=""
if command -v docker >/dev/null; then
  v=$(docker version --format '{{.Server.Version}}' 2>/dev/null) && [ -n "$v" ] && docker_v="$v"
  v=$(docker compose version --short 2>/dev/null) && [ -n "$v" ] && compose_v="$v"
  if [ "$docker_v" != absent ]; then
    docker image inspect "$PW_IMAGE" >/dev/null 2>&1 && image=present
    projects=$(E2E_DOCKER=docker list_e2e_projects)
  fi
fi

# setup/.env and keys
env_file=false; [ -f "$ROOT/setup/.env" ] && env_file=true
KEYS="$KEY_NAMES"
if [ "$env_file" = true ]; then
  # A live check every time; it also refreshes the cache that run-e2e.sh reuses.
  KEYS_NO_EXIT=1 KEYS_LIVE=1 check_keys >/dev/null 2>&1 || true
else
  for k in $KEYS; do eval "KEY_STATUS_$k=missing"; done
fi

# a gateway a reader already runs
gw_state=absent; gw_version=""
out=$("$CURL" -s -m 5 -w '\n%{http_code}' http://localhost:15000/api/runtime 2>/dev/null || true)
gw_code="${out##*$'\n'}"; body="${out%$'\n'*}"
if [ "$gw_code" = 200 ]; then
  gw_version=$(printf '%s' "$body" | tr -d '\n' | sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' | head -1)
  [ -z "$gw_version" ] || gw_state=running
fi

# ports (check-ports.sh checks compose against the labs; no script means nothing to flag)
ports=ok
if [ -f "$ROOT/e2e/check-ports.sh" ]; then bash "$ROOT/e2e/check-ports.sh" >/dev/null 2>&1 || ports=fail; fi

# setup/config.yaml edits; no git counts as not dirty
dirty=false; dirty_err=""
if command -v git >/dev/null && git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$ROOT" diff --quiet HEAD -- setup/config.yaml >/dev/null 2>&1; rc=$?
  case "$rc" in 0) ;; 1) dirty=true ;; *) dirty_err="$rc" ;; esac
fi

# node and the Playwright MCP
node_v=$(node --version 2>/dev/null) || node_v=absent
[ -n "$node_v" ] || node_v=absent
pw_mcp=false
if command -v npx >/dev/null; then run_capped 20 npx --no-install @playwright/mcp --version && pw_mcp=true; fi

# python3 and jq (session-log.sh and the agent's JSON reads), gh (contribute only, informational)
tool_v() { # tool_v <command> <version args...>: first line of its version output, or absent
  local c="$1"; shift
  command -v "$c" >/dev/null 2>&1 || { echo absent; return; }
  local v; v=$("$c" "$@" 2>/dev/null | head -1)
  echo "${v:-present}"
}
python3_v=$(tool_v python3 --version)
jq_v=$(tool_v jq --version)
gh_v=$(tool_v gh --version)

# build env.json
keys_json=""
for k in $KEYS; do
  eval "s=\${KEY_STATUS_$k:-missing}"
  keys_json="$keys_json${keys_json:+, }\"$k\": \"$s\""
done
if [ "$gw_state" = running ]; then gw_json="{\"state\":\"running\",\"version\":$(json_str "$gw_version")}"; else gw_json='{"state":"absent"}'; fi
left_json=""
for p in $projects; do left_json="$left_json${left_json:+, }$(json_str "$p")"; done

mkdir -p "$WORK_ROOT"
{
  printf '{\n'
  printf '  "docker": %s,\n' "$(json_str "$docker_v")"
  printf '  "compose": %s,\n' "$(json_str "$compose_v")"
  printf '  "playwright_image": %s,\n' "$(json_str "$image")"
  printf '  "env_file": %s,\n' "$env_file"
  printf '  "keys": {%s},\n' "$keys_json"
  printf '  "user_gateway": %s,\n' "$gw_json"
  printf '  "ports": "%s",\n' "$ports"
  printf '  "leftover_projects": [%s],\n' "$left_json"
  printf '  "setup_config_dirty": %s,\n' "$dirty"
  [ -z "$dirty_err" ] || printf '  "setup_config_dirty_error": "%s",\n' "$dirty_err"
  printf '  "node": %s,\n' "$(json_str "$node_v")"
  printf '  "playwright_mcp": %s,\n' "$pw_mcp"
  printf '  "python3": %s,\n' "$(json_str "$python3_v")"
  printf '  "jq": %s,\n' "$(json_str "$jq_v")"
  printf '  "gh": %s,\n' "$(json_str "$gh_v")"
  printf '  "detected_at": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '}\n'
} > "$WORK_ROOT/env.json"

echo "docker: $docker_v"
echo "compose: $compose_v"
echo "playwright_image: $image"
echo "env_file: $env_file"
for k in $KEYS; do eval "echo \"$k: \${KEY_STATUS_$k:-missing}\""; done
echo "user_gateway: $gw_state${gw_version:+ $gw_version}"
echo "ports: $ports"
echo "leftover_projects: ${projects:-none}" | tr '\n' ' ' | sed 's/ $//'; echo
echo "setup_config_dirty: $dirty"
echo "node: $node_v"
echo "playwright_mcp: $pw_mcp"
echo "python3: $python3_v"
echo "jq: $jq_v"
echo "gh: $gh_v"

missing=0
[ "$docker_v" != absent ] || { echo "missing: docker"; missing=1; }
[ "$compose_v" != absent ] || { echo "missing: docker compose"; missing=1; }
[ "$python3_v" != absent ] || { echo "missing: python3 (session-log.sh needs it)"; missing=1; }
[ "$jq_v" != absent ] || { echo "missing: jq"; missing=1; }
[ "$env_file" = true ] || { echo "missing: setup/.env (copy setup/.env.example and fill in keys)"; missing=1; }
[ "${KEY_STATUS_OPENAI_API_KEY:-missing}" = ok ] || { echo "missing: a working OPENAI_API_KEY (${KEY_STATUS_OPENAI_API_KEY:-missing})"; missing=1; }
[ "$missing" -eq 0 ] || exit 2
exit 0
