#!/usr/bin/env bash
# Runs one lab spec (or all of them) against a throwaway gateway.
#
#   e2e/run-e2e.sh <id>|all [--update-screenshots]
#   e2e/run-e2e.sh --track <llm|mcp|platform|all> [--update-screenshots]
#   e2e/run-e2e.sh --list [--track <t>]       one line per spec: id, lab path, profiles; runs nothing
#   e2e/run-e2e.sh --report-only              rebuild the report from the last run (not built yet)
#
# Each run leaves e2e/.work/<id with / as ->/ with outcome (one status line), playwright.json and,
# on a failure, gateway.log. E2E_WORK_ROOT replaces e2e/.work; E2E_DOCKER replaces docker.
#
# <id> is a spec path under e2e/labs without the suffix: 001, llm/virtual-api-keys, mcp/openapi-to-mcp.
# A spec declares what it needs in header comments:
#   // @fixture base                   start config, default: base (setup/config.yaml); others are e2e/fixtures/<name>.yaml
#   // @expect base                    config the lab must end in, default: the start fixture
#   // @profiles mock-llm,ext-authz    Compose helper profiles to start
#   // @docker yes                     mount the Docker socket, so the spec can stop and start helpers
#   // @restarts gateway               the spec restarts the gateway: a pause container holds the network
#                                      (compose.e2e-restart.yaml), so the test browser keeps it
#
# The gateway publishes no host ports. Playwright runs in a container that shares the
# gateway's network namespace, so specs use http://localhost:15000 and the real gateway ports.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PW_IMAGE="mcr.microsoft.com/playwright:v1.64.1-noble"

usage() { echo "usage: $0 <id>|all [--update-screenshots] | --track <llm|mcp|platform|all> | --list [--track <t>] | --report-only" >&2; exit 64; }
E2E_DOCKER="${E2E_DOCKER:-docker}"
TARGET=""; TRACK=""; LIST=0; REPORT_ONLY=0; UPDATE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --update-screenshots) UPDATE=1 ;;
    --list) LIST=1 ;;
    --report-only) REPORT_ONLY=1 ;;
    --track) [ $# -ge 2 ] || usage; TRACK="$2"; shift ;;
    -*) usage ;;
    *) [ -z "$TARGET" ] || usage; TARGET="$1" ;;
  esac
  shift
done
[ "$TARGET" = all ] && { TARGET=""; TRACK="${TRACK:-all}"; }
case "${TRACK:-all}" in llm|mcp|platform|all) ;; *) echo "unknown track: $TRACK (llm, mcp, platform or all)" >&2; exit 64 ;; esac
if [ "$REPORT_ONLY" = 1 ]; then echo "report builder not available yet" >&2; exit 2; fi
if [ "$LIST" = 0 ] && [ -z "$TARGET" ] && [ -z "$TRACK" ]; then usage; fi
if [ -n "$TARGET" ] && [ -n "$TRACK" ]; then usage; fi

[ "$LIST" = 1 ] || [ -f "$ROOT/setup/.env" ] || { echo "missing setup/.env (copy setup/.env.example and fill in keys)" >&2; exit 1; }

WORK_ROOT="${E2E_WORK_ROOT:-$ROOT/e2e/.work}"

# Install test dependencies once, inside the Linux image.
if [ "$LIST" = 0 ] && [ ! -d "$ROOT/e2e/node_modules/@playwright/test" ]; then
  "$E2E_DOCKER" run --rm -v "$ROOT:/repo" -w /repo/e2e "$PW_IMAGE" npm install --no-audit --no-fund --loglevel=error
fi

# env_val, status_of and check_keys live in e2e/lib/keys.sh, shared with detect-env.sh.
# shellcheck source=lib/keys.sh
source "$ROOT/e2e/lib/keys.sh"

# Fixture file relative to the repo root; keep in step with fixturePath() in e2e/lib/normalize.mjs.
fixture_file() { [ "$1" = base ] && echo setup/config.yaml || echo "e2e/fixtures/$1.yaml"; }

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
  local restarts
  restarts=$(header "$spec" restarts no)
  local f
  for f in "$fixture" "$expect"; do
    [ -f "$ROOT/$(fixture_file "$f")" ] || { echo "no fixture: $(fixture_file "$f")" >&2; return 1; }
  done

  local project="agw-e2e-$(echo "$id" | tr '/' '-' | tr -c 'a-z0-9-\n' '-')"
  local work
  work=$(mktemp -d "${TMPDIR:-/tmp}/agw-e2e.XXXXXX")

  local files=(-f "$work/docker-compose.yml" -f "$ROOT/e2e/compose.e2e.yaml")
  [ "$restarts" = gateway ] && files+=(-f "$ROOT/e2e/compose.e2e-restart.yaml")

  cleanup_one() {
    "$E2E_DOCKER" compose -p "$project" --project-directory "$work" "${files[@]}" \
      --profile "*" down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$work"
  }
  trap cleanup_one RETURN
  local rdir="$WORK_ROOT/$(echo "$id" | tr '/' '-')"
  rm -rf "$rdir"; mkdir -p "$rdir"
  local started=$SECONDS

  # Copy the reader's setup, then swap in the start fixture.
  (cd "$ROOT/setup" && tar cf - --exclude 'data.db*' .) | (cd "$work" && tar xf -)
  cp "$ROOT/$(fixture_file "$fixture")" "$work/config.yaml"

  local profile_args=()
  if [ -n "$profiles" ]; then
    IFS=',' read -ra ps <<<"$profiles"
    for p in "${ps[@]}"; do profile_args+=(--profile "$p"); done
  fi

  echo "=== $id (fixture: $fixture, expect: $expect, profiles: ${profiles:-none})"
  env UID="$(id -u)" GID="$(id -g)" "$E2E_DOCKER" compose -p "$project" --project-directory "$work" \
    "${files[@]}" ${profile_args[@]+"${profile_args[@]}"} --progress quiet up -d --quiet-pull

  local gw net
  gw=$("$E2E_DOCKER" compose -p "$project" --project-directory "$work" "${files[@]}" ps -q agentgateway)
  net="$gw"
  [ "$restarts" = gateway ] && net=$("$E2E_DOCKER" compose -p "$project" --project-directory "$work" "${files[@]}" ps -q netns)

  # The container runs the test, then summarises the Playwright JSON into $rdir/outcome-parse
  # (unless the host parses it, E2E_OUTCOME_ON_HOST=1), then compares the final config.
  local cdir="/repo/e2e/.work/$(basename "$rdir")"
  local json_in_container="$cdir/playwright.json"
  local parse_cmd="node lib/outcome.mjs '$json_in_container' > '$cdir/outcome-parse'"
  [ "${E2E_OUTCOME_ON_HOST:-0}" = 1 ] && parse_cmd=true
  set +e
  "$E2E_DOCKER" run --rm --network "container:$net" \
    -v "$ROOT:/repo" -v "$rdir:$cdir" -v "$work:/work" ${docker_args[@]+"${docker_args[@]}"} -w /repo/e2e \
    -e UPDATE_SCREENSHOTS="$UPDATE" -e HAS_ANTHROPIC="$HAS_ANTHROPIC" -e HAS_AWS="$HAS_AWS" -e HAS_BEDROCK_KEY="$HAS_BEDROCK_KEY" -e HAS_TYPESAFE="$HAS_TYPESAFE" \
    -e HAS_CLAUDE_OAUTH="$HAS_CLAUDE_OAUTH" -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" -e LAB_FIXTURE="$fixture" \
    -e COMPOSE_PROJECT="$project" -e NPM_CONFIG_UPDATE_NOTIFIER=false -e PW_OUTPUT_DIR="/repo/e2e/.last/pw-results/$project" \
    -e PLAYWRIGHT_JSON_OUTPUT_NAME="$json_in_container" \
    "$PW_IMAGE" bash -c "
      for i in \$(seq 1 60); do curl -sf localhost:15000/api/runtime >/dev/null && break; sleep 1; done
      npx playwright test 'labs/$id.spec.ts' --reporter=list,json; t=\$?
      $parse_cmd
      [ \$t -eq 0 ] || exit 1
      node lib/compare.mjs /work/config.yaml '/repo/$(fixture_file "$expect")' || exit 2
    "
  local rc=$?
  set -e
  # Keep the final config for writing fixtures and debugging.
  mkdir -p "$ROOT/e2e/.last"
  cp "$work/config.yaml" "$ROOT/e2e/.last/$(echo "$id" | tr '/' '-').yaml"
  if [ $rc -ne 0 ]; then
    "$E2E_DOCKER" logs "$gw" > "$rdir/gateway.log" 2>&1 || true
    echo "--- gateway log (last 40 lines)"
    tail -n 40 "$rdir/gateway.log" | cut -c1-300
  fi

  cleanup_one
  trap - RETURN
  leftover_check
  local leftover=$LEFTOVER_N

  [ "${E2E_OUTCOME_ON_HOST:-0}" = 1 ] && node "$ROOT/e2e/lib/outcome.mjs" "$rdir/playwright.json" > "$rdir/outcome-parse"
  local parsed tests skipped first_failure reason=""
  parsed=$(cat "$rdir/outcome-parse" 2>/dev/null || echo "tests=0 skipped=0 failed=0 first_failure=-")
  tests=$(echo "$parsed" | sed -E 's/.*tests=([0-9]+).*/\1/')
  skipped=$(echo "$parsed" | sed -E 's/.*skipped=([0-9]+).*/\1/')
  first_failure=$(echo "$parsed" | sed -E 's/.*first_failure=//')
  rm -f "$rdir/outcome-parse"
  case $rc in
    0) [ "$leftover" -gt 0 ] && reason="leftover projects remain" ;;
    2) reason="config did not return to $expect" ;;
    *) if [ "$first_failure" != "-" ]; then reason="$first_failure"; else reason="tests failed"; fi ;;
  esac
  local status=pass final=$rc
  if [ $rc -ne 0 ] || [ "$leftover" -gt 0 ]; then status=fail; fi
  [ $rc -eq 0 ] && [ "$leftover" -gt 0 ] && final=1
  echo "status=$status rc=$rc duration=$((SECONDS - started)) tests=$tests skipped=$skipped fixture=$fixture expect=$expect profiles=${profiles:--} leftover=$leftover$([ $rc -eq 2 ] && echo ' config_mismatch=1')${reason:+ reason=$reason}" > "$rdir/outcome"
  echo "=== $id: $([ $final -eq 0 ] && echo PASS || echo "FAIL (rc=$final)")"
  return $final
}

# Prints a LEFTOVER PROJECT line for each agw-e2e-* Compose project still listed and sets LEFTOVER_N.
LEFTOVER_N=0
leftover_check() {
  local name
  LEFTOVER_N=0
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    echo "LEFTOVER PROJECT: $name"
    LEFTOVER_N=$((LEFTOVER_N + 1))
  done < <("$E2E_DOCKER" compose ls --format json 2>/dev/null | grep -oE '"Name" *: *"agw-e2e-[^"]*"' | sed -E 's/.*"(agw-e2e-[^"]*)"/\1/' || true)
}

# The ids of the specs for a track, one per line: the intro labs of the track, then README order,
# then any other spec by name. Specs without a file are dropped.
order_ids() {
  local track="$1" seen=$'\n' id f
  local candidates
  case "$track" in
    llm) candidates="001 llm/connect-llm-providers" ;;
    mcp) candidates="mcp/connect-remote-mcp-server" ;;
    platform) candidates="" ;;
    *) candidates="001 llm/connect-llm-providers mcp/connect-remote-mcp-server" ;;
  esac
  candidates="$candidates $(grep -oE '\]\(labs/[a-z0-9-]+/[a-z0-9-]+\.md\)' "$ROOT/README.md" | sed -E 's/^\]\(labs\/(.*)\.md\)$/\1/' | tr '\n' ' ')"
  candidates="$candidates $(find "$ROOT/e2e/labs" -name '*.spec.ts' | sort | sed -E "s|^$ROOT/e2e/labs/||; s|\.spec\.ts$||" | tr '\n' ' ')"
  for id in $candidates; do
    [ "$id" = smoke ] && continue
    [ "$track" = all ] || case "$id" in "$track"/*) ;; 001) [ "$track" = llm ] || continue ;; *) continue ;; esac
    [ -f "$ROOT/e2e/labs/$id.spec.ts" ] || continue
    case "$seen" in *$'\n'"$id"$'\n'*) continue ;; esac
    seen="$seen$id"$'\n'
    echo "$id"
  done
}

# lab_path <id>: the lab's markdown file relative to the repo root.
lab_path() {
  if [ -f "$ROOT/labs/$1.md" ]; then echo "labs/$1.md"
  else f=$(ls "$ROOT"/labs/"$1"-*.md 2>/dev/null | head -1); echo "labs/$(basename "${f:-$1.md}")"; fi
}

if [ "$LIST" = 1 ]; then
  while IFS= read -r id; do
    p=$(header "$ROOT/e2e/labs/$id.spec.ts" profiles "")
    printf '%s\t%s\t%s\n' "$id" "$(lab_path "$id")" "${p:--}"
  done < <(order_ids "${TRACK:-all}")
  KEYS_NO_EXIT=1
  check_keys
  exit $?
fi

check_keys

if [ -n "$TRACK" ]; then
  ids=()
  while IFS= read -r id; do ids+=("$id"); done < <(order_ids "$TRACK")
  failed=()
  for id in ${ids[@]+"${ids[@]}"}; do
    run_one "$id" || failed+=("$id")
  done
  echo
  if [ ${#failed[@]} -eq 0 ]; then echo "ALL PASS (${#ids[@]} labs)"; else echo "FAILED: ${failed[*]}"; exit 1; fi
else
  run_one "$TARGET"
fi
