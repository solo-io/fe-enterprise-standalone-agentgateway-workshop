#!/usr/bin/env bash
# Runs one lab spec (or all of them) against a throwaway gateway.
#
#   e2e/run-e2e.sh <id>|all [--update-screenshots]
#
# <id> is a spec path under e2e/labs without the suffix: 001, llm/virtual-api-keys, mcp/openapi-to-mcp.
# A spec declares what it needs in header comments:
#   // @fixture base                   start config (e2e/fixtures/<name>.yaml), default: base
#   // @expect base                    config the lab must end in, default: the start fixture
#   // @profiles mock-llm,ext-authz    Compose helper profiles to start
#   // @docker yes                     mount the Docker socket, so the spec can stop and start helpers
#
# The gateway publishes no host ports. Playwright runs in a container that shares the
# gateway's network namespace, so specs use http://localhost:15000 and the real gateway ports.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PW_IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble"

usage() { echo "usage: $0 <id>|all [--update-screenshots]" >&2; exit 64; }
[ $# -ge 1 ] || usage
TARGET="$1"; shift
UPDATE=0
for a in "$@"; do
  case "$a" in
    --update-screenshots) UPDATE=1 ;;
    *) usage ;;
  esac
done

[ -f "$ROOT/setup/.env" ] || { echo "missing setup/.env (copy setup/.env.example and fill in keys)" >&2; exit 1; }

# Install test dependencies once, inside the Linux image.
if [ ! -d "$ROOT/e2e/node_modules/@playwright/test" ]; then
  docker run --rm -v "$ROOT:/repo" -w /repo/e2e "$PW_IMAGE" npm install --no-audit --no-fund --loglevel=error
fi

header() { # header <spec> <key> <default>
  local v
  v=$(grep -m1 -E "^// @$2 " "$1" | sed -E "s|^// @$2 +||" || true)
  echo "${v:-$3}"
}

run_one() {
  local id="$1"
  local spec="$ROOT/e2e/labs/$id.spec.ts"
  [ -f "$spec" ] || { echo "no spec: $spec" >&2; return 1; }

  local fixture expect profiles
  fixture=$(header "$spec" fixture base)
  expect=$(header "$spec" expect "$fixture")
  profiles=$(header "$spec" profiles "")
  local docker_args=()
  [ "$(header "$spec" docker no)" = yes ] && docker_args=(-v /var/run/docker.sock:/var/run/docker.sock)

  local project="agw-e2e-$(echo "$id" | tr '/' '-' | tr -c 'a-z0-9-\n' '-')"
  local work
  work=$(mktemp -d "${TMPDIR:-/tmp}/agw-e2e.XXXXXX")

  cleanup_one() {
    docker compose -p "$project" --project-directory "$work" -f "$work/docker-compose.yml" -f "$ROOT/e2e/compose.e2e.yaml" \
      --profile "*" down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$work"
  }
  trap cleanup_one RETURN

  # Copy the reader's setup, then swap in the start fixture.
  (cd "$ROOT/setup" && tar cf - --exclude 'data.db*' .) | (cd "$work" && tar xf -)
  cp "$ROOT/e2e/fixtures/$fixture.yaml" "$work/config.yaml"

  local profile_args=()
  if [ -n "$profiles" ]; then
    IFS=',' read -ra ps <<<"$profiles"
    for p in "${ps[@]}"; do profile_args+=(--profile "$p"); done
  fi

  echo "=== $id (fixture: $fixture, expect: $expect, profiles: ${profiles:-none})"
  env UID="$(id -u)" GID="$(id -g)" docker compose -p "$project" --project-directory "$work" \
    -f "$work/docker-compose.yml" -f "$ROOT/e2e/compose.e2e.yaml" ${profile_args[@]+"${profile_args[@]}"} --progress quiet up -d --quiet-pull

  local gw
  gw=$(docker compose -p "$project" --project-directory "$work" -f "$work/docker-compose.yml" ps -q agentgateway)

  local has_anthropic=0 has_aws=0 has_bedrock_key=0
  grep -qE '^ANTHROPIC_API_KEY=.+' "$ROOT/setup/.env" && has_anthropic=1
  # AWS values exported in the shell take precedence over setup/.env, as in Docker Compose.
  { [ -n "${AWS_ACCESS_KEY_ID:-}" ] || grep -qE '^AWS_ACCESS_KEY_ID=.+' "$ROOT/setup/.env"; } && has_aws=1
  { [ -n "${BEDROCK_API_KEY:-}" ] || grep -qE '^BEDROCK_API_KEY=.+' "$ROOT/setup/.env"; } && has_bedrock_key=1

  set +e
  docker run --rm --network "container:$gw" \
    -v "$ROOT:/repo" -v "$work:/work" ${docker_args[@]+"${docker_args[@]}"} -w /repo/e2e \
    -e UPDATE_SCREENSHOTS="$UPDATE" -e HAS_ANTHROPIC="$has_anthropic" -e HAS_AWS="$has_aws" -e HAS_BEDROCK_KEY="$has_bedrock_key" -e LAB_FIXTURE="$fixture" \
    -e COMPOSE_PROJECT="$project" -e NPM_CONFIG_UPDATE_NOTIFIER=false -e PW_OUTPUT_DIR="/repo/e2e/.last/pw-results/$project" \
    "$PW_IMAGE" bash -c "
      for i in \$(seq 1 60); do curl -sf localhost:15000/api/runtime >/dev/null && break; sleep 1; done
      npx playwright test 'labs/$id.spec.ts' || exit 1
      node lib/compare.mjs /work/config.yaml 'fixtures/$expect.yaml' || exit 2
    "
  local rc=$?
  set -e
  # Keep the final config for writing fixtures and debugging.
  mkdir -p "$ROOT/e2e/.last"
  cp "$work/config.yaml" "$ROOT/e2e/.last/$(echo "$id" | tr '/' '-').yaml"
  if [ $rc -ne 0 ]; then
    echo "--- gateway log (last 40 lines)"
    docker logs --tail 40 "$gw" 2>&1 | cut -c1-300
  fi
  echo "=== $id: $([ $rc -eq 0 ] && echo PASS || echo "FAIL (rc=$rc)")"
  return $rc
}

if [ "$TARGET" = "all" ]; then
  # 001 and the intro labs first, then the rest in name order.
  ids=(001 llm/connect-llm-providers mcp/connect-remote-mcp-server)
  while IFS= read -r f; do
    id="${f#$ROOT/e2e/labs/}"; id="${id%.spec.ts}"
    case " ${ids[*]} " in *" $id "*) ;; *) [ "$id" = smoke ] || ids+=("$id") ;; esac
  done < <(find "$ROOT/e2e/labs" -name '*.spec.ts' | sort)
  failed=()
  for id in "${ids[@]}"; do
    [ -f "$ROOT/e2e/labs/$id.spec.ts" ] || continue
    run_one "$id" || failed+=("$id")
  done
  echo
  if [ ${#failed[@]} -eq 0 ]; then echo "ALL PASS (${#ids[@]} labs)"; else echo "FAILED: ${failed[*]}"; exit 1; fi
else
  run_one "$TARGET"
fi
