#!/usr/bin/env bash
# Runs one lab spec (or all of them) against a throwaway gateway.
#
#   e2e/run-e2e.sh <id>|all [--update-screenshots]
#   e2e/run-e2e.sh --track <llm|mcp|platform|all> [--update-screenshots]
#   e2e/run-e2e.sh --list [--track <t>]       one line per spec: id, lab path, profiles; runs nothing
#   e2e/run-e2e.sh --custom <name> [--update-screenshots] [--lint]
#                                             run (or only lint) custom-labs/<name>/, a lab you wrote
#   e2e/run-e2e.sh --report-only (--track <t> | --custom <name>)
#                                             rebuild the report from the last run into reports/ (or custom-labs/<name>/reports/)
#   e2e/run-e2e.sh <id> --skip <id>  |  --track <t> --skip <id> [--skip <id>...]
#                                             do not run these ids; each gets outcome status=skip reason=declined
#   e2e/run-e2e.sh --learn <name> [--profiles <p1,p2>] | --learn <name> (--diff | --restart | --stop)
#                                             the learning gateway for adapt (Compose project agw-e2e-learn), see e2e/lib/learn.sh
#
# Each run leaves e2e/.work/<id with / as ->/ with outcome (one status line), playwright.json and,
# on a failure, gateway.log. E2E_WORK_ROOT replaces e2e/.work; E2E_DOCKER replaces docker.
# A custom lab keeps everything a run or a learning phase writes inside its own folder, so deleting
# custom-labs/<name>/ removes all of it: custom-labs/<name>/.work/run/ (outcome, playwright.json, gateway.log,
# config.yaml), .work/pw-results/ (failure screenshots and traces), .work/learn/ (--learn) and .work/shots-before/.
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

usage() { echo "usage: $0 <id>|all [--update-screenshots] [--skip <id>...] | --track <llm|mcp|platform|all> [--skip <id>...] | --list [--track <t>] | --custom <name> [--update-screenshots] [--lint] | --report-only (--track <t> | --custom <name>) | --learn <name> [--profiles <p1,p2> | --diff | --restart | --stop]" >&2; exit 64; }
CUSTOM_ROOT="${E2E_CUSTOM_ROOT:-$ROOT/custom-labs}"
CUSTOM=""; LINT=0
E2E_DOCKER="${E2E_DOCKER:-docker}"
TARGET=""; TRACK=""; LIST=0; REPORT_ONLY=0; UPDATE=0
SKIPS=(); LEARN=""; LEARN_ACTION=start; LEARN_PROFILES=""; LEARN_PROFILES_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --update-screenshots) UPDATE=1 ;;
    --list) LIST=1 ;;
    --report-only) REPORT_ONLY=1 ;;
    --lint) LINT=1 ;;
    --custom) [ $# -ge 2 ] || usage; CUSTOM="$2"; shift ;;
    --track) [ $# -ge 2 ] || usage; TRACK="$2"; shift ;;
    --skip) [ $# -ge 2 ] || usage; SKIPS+=("$2"); shift ;;
    --learn) [ $# -ge 2 ] || usage; LEARN="$2"; shift ;;
    --diff|--restart|--stop) [ "$LEARN_ACTION" = start ] || usage; LEARN_ACTION="${1#--}" ;;
    --profiles) [ $# -ge 2 ] || usage; LEARN_PROFILES="$2"; LEARN_PROFILES_SET=1; shift ;;
    -*) usage ;;
    *) [ -z "$TARGET" ] || usage; TARGET="$1" ;;
  esac
  shift
done
[ "$TARGET" = all ] && { TARGET=""; TRACK="${TRACK:-all}"; }
case "${TRACK:-all}" in llm|mcp|platform|all) ;; *) echo "unknown track: $TRACK (llm, mcp, platform or all)" >&2; exit 64 ;; esac
# A custom lab name and a learning name: lowercase letters, digits and hyphens, starting with a letter or digit.
valid_name() { echo "$1" | grep -qE '^[a-z0-9][a-z0-9-]*$'; }
# --diff, --restart, --stop and --profiles go only with --learn; --learn goes with nothing else.
if [ -z "$LEARN" ]; then
  [ "$LEARN_ACTION" = start ] && [ "$LEARN_PROFILES_SET" = 0 ] || usage
else
  [ -z "$TARGET" ] && [ -z "$TRACK" ] && [ -z "$CUSTOM" ] && [ "$LIST$REPORT_ONLY$LINT$UPDATE" = 0000 ] && [ ${#SKIPS[@]} -eq 0 ] || usage
  [ "$LEARN_ACTION" = start ] || [ "$LEARN_PROFILES_SET" = 0 ] || usage
  valid_name "$LEARN" \
    || { echo "invalid learning name: $LEARN (lowercase letters, digits and hyphens, starting with a letter or digit)" >&2; exit 64; }
fi
# --skip needs a run of an id or a track.
if [ ${#SKIPS[@]} -gt 0 ]; then
  { [ -n "$TARGET" ] || [ -n "$TRACK" ]; } && [ -z "$CUSTOM" ] && [ "$LIST$REPORT_ONLY" = 00 ] || usage
fi
if [ -n "$CUSTOM" ]; then
  [ -z "$TARGET" ] && [ -z "$TRACK" ] && [ "$LIST" = 0 ] || usage
  valid_name "$CUSTOM" \
    || { echo "invalid custom lab name: $CUSTOM (lowercase letters, digits and hyphens, starting with a letter or digit)" >&2; exit 64; }
  missing=0
  for f in "$CUSTOM_ROOT/$CUSTOM/$CUSTOM.md" "$CUSTOM_ROOT/$CUSTOM/$CUSTOM.spec.ts"; do
    [ -f "$f" ] || { echo "missing custom lab file: custom-labs/$CUSTOM/$(basename "$f") (expected at $f)" >&2; missing=1; }
  done
  [ $missing -eq 0 ] || exit 1
  # An absolute path, so Docker mounts the folder instead of creating a named volume.
  CUSTOM_ROOT="$(cd "$CUSTOM_ROOT" && pwd)"
  if [ "$LINT" = 1 ]; then
    exec "$ROOT/e2e/lint.sh" --file "$CUSTOM_ROOT/$CUSTOM/$CUSTOM.md" --spec "$CUSTOM_ROOT/$CUSTOM/$CUSTOM.spec.ts" --custom
  fi
elif [ "$LINT" = 1 ]; then usage
fi
# env_val, status_of, check_keys and list_e2e_projects live in e2e/lib/keys.sh, shared with detect-env.sh.
# shellcheck source=lib/keys.sh
source "$ROOT/e2e/lib/keys.sh"

# Candidate ids for a track, in order and with repeats: intro labs, README links, then every spec by name.
candidate_ids() {
  case "$1" in
    llm) printf '%s\n' 001 llm/connect-llm-providers ;;
    mcp) printf '%s\n' mcp/connect-remote-mcp-server ;;
    platform) ;;
    *) printf '%s\n' 001 llm/connect-llm-providers mcp/connect-remote-mcp-server ;;
  esac
  grep -oE '\]\(labs/[a-z0-9-]+/[a-z0-9-]+\.md\)' "$ROOT/README.md" | sed -E 's/^\]\(labs\/(.*)\.md\)$/\1/'
  find "$ROOT/e2e/labs" -name '*.spec.ts' | sort | sed -E "s|^$ROOT/e2e/labs/||; s|\.spec\.ts\$||"
}

# The ids of the specs for a track, one per line: the intro labs of the track, then README order,
# then any other spec by name. Specs without a file are dropped.
order_ids() {
  local track="$1" seen=$'\n' id
  while IFS= read -r id; do
    [ "$id" = smoke ] && continue
    [ "$track" = all ] || case "$id" in "$track"/*) ;; 001) [ "$track" = llm ] || continue ;; *) continue ;; esac
    [ -f "$ROOT/e2e/labs/$id.spec.ts" ] || continue
    case "$seen" in *$'\n'"$id"$'\n'*) continue ;; esac
    seen="$seen$id"$'\n'
    echo "$id"
  done < <(candidate_ids "$track")
}

if [ "$REPORT_ONLY" = 1 ]; then
  [ -z "$TARGET" ] && [ "$LIST" = 0 ] && { [ -n "$TRACK" ] || [ -n "$CUSTOM" ]; } || usage
  RWORK="${E2E_WORK_ROOT:-$ROOT/e2e/.work}"
  RWORK="$(cd "$RWORK" 2>/dev/null && pwd || echo "$RWORK")"
  # The host runs node when it has it; otherwise the Playwright image does, with the repo at /repo and the work dir at /work.
  if command -v node >/dev/null 2>&1; then
    rbase="$ROOT"; rcustom="$CUSTOM_ROOT"; rwork="$RWORK"; runner=(node)
  else
    rbase=/repo; rcustom=/repo/custom-labs; rwork=/work
    mount=(-v "$ROOT:/repo" -v "$RWORK:/work")
    [ -n "${E2E_CUSTOM_ROOT:-}" ] && [ -n "$CUSTOM" ] && mount+=(-v "$CUSTOM_ROOT:/repo/custom-labs")
    runner=("$E2E_DOCKER" run --rm "${mount[@]}" -w /repo/e2e "$PW_IMAGE" node)
  fi
  rargs=(build --work "$rwork" --env-json "$rwork/env.json" --session "$rwork/session.jsonl" --compose "$rbase/setup/docker-compose.yml")
  if [ -n "$CUSTOM" ]; then
    mkdir -p "$CUSTOM_ROOT/$CUSTOM/reports"
    rargs+=(--out "$rcustom/$CUSTOM/reports" --custom "$CUSTOM" --spec "$rcustom/$CUSTOM/$CUSTOM.spec.ts" --run "$rcustom/$CUSTOM/.work/run")
  else
    mkdir -p "$ROOT/reports"
    rargs+=(--out "$rbase/reports" --track "$TRACK")
    # The ids the track covers, so a lab that never ran still gets a row.
    mkdir -p "$RWORK"
    order_ids "$TRACK" > "$RWORK/planned-$TRACK.txt"
    rargs+=(--planned "$rwork/planned-$TRACK.txt")
  fi
  # Re-list the projects now: the session-start list in env.json can be out of date. A failed listing records nothing.
  mkdir -p "$RWORK"
  if list_e2e_projects > "$RWORK/projects-now.txt"; then
    rargs+=(--projects-now "$rwork/projects-now.txt")
  else
    rm -f "$RWORK/projects-now.txt"
  fi
  exec "${runner[@]}" "$rbase/e2e/lib/report.mjs" "${rargs[@]}"
fi
if [ "$LIST" = 0 ] && [ -z "$TARGET" ] && [ -z "$TRACK" ] && [ -z "$CUSTOM" ] && [ -z "$LEARN" ]; then usage; fi
if [ -n "$TARGET" ] && [ -n "$TRACK" ]; then usage; fi

WORK_ROOT="${E2E_WORK_ROOT:-$ROOT/e2e/.work}"
mkdir -p "$WORK_ROOT" 2>/dev/null || true
WORK_ROOT="$(cd "$WORK_ROOT" 2>/dev/null && pwd || echo "$WORK_ROOT")"

need_env() { [ -f "$ROOT/setup/.env" ] || { echo "missing setup/.env (copy setup/.env.example and fill in keys)" >&2; exit 1; }; }

# What a run needs before its first lab: setup/.env, the test dependencies and the key checks.
# A run whose ids are all skipped needs none of them.
prepare_run() {
  need_env
  # Install test dependencies once, inside the Linux image.
  if [ ! -d "$ROOT/e2e/node_modules/@playwright/test" ]; then
    "$E2E_DOCKER" run --rm -v "$ROOT:/repo" -w /repo/e2e "$PW_IMAGE" npm install --no-audit --no-fund --loglevel=error
  fi
  check_keys
}

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
  local custom=0 test_file="labs/$id.spec.ts" rel
  rel="$(echo "$id" | tr '/' '-')"
  local custom_env=() custom_mount=()
  # Where this run's files go: e2e/.work/<rel> and e2e/.last/ for a shipped lab, the lab's own .work/ for a custom lab.
  local rdir="$WORK_ROOT/$rel" cdir="/repo/e2e/.work/$rel" pw_out="" last_cfg="$ROOT/e2e/.last/$rel.yaml"
  if [ "$id" != "${id#custom/}" ]; then
    custom=1; spec="$CUSTOM_ROOT/${id#custom/}/${id#custom/}.spec.ts"; test_file="custom/${id#custom/}.spec.ts"; rel="$id"
    rdir="$CUSTOM_ROOT/${id#custom/}/.work/run"; cdir="/repo/custom-labs/${id#custom/}/.work/run"
    pw_out="/repo/custom-labs/${id#custom/}/.work/pw-results"; last_cfg="$rdir/config.yaml"
    custom_env=(-e PW_TEST_DIR=custom -e "LAB_IMAGES_DIR=/repo/custom-labs/${id#custom/}/images")
    [ -n "${E2E_CUSTOM_ROOT:-}" ] && custom_mount=(-v "$CUSTOM_ROOT:/repo/custom-labs")
  fi
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
  [ -n "$pw_out" ] || pw_out="/repo/e2e/.last/pw-results/$project"
  local work
  work=$(mktemp -d "${TMPDIR:-/tmp}/agw-e2e.XXXXXX")

  local files=(-f "$work/docker-compose.yml" -f "$ROOT/e2e/compose.e2e.yaml")
  [ "$restarts" = gateway ] && files+=(-f "$ROOT/e2e/compose.e2e-restart.yaml")

  cleanup_one() {
    [ $custom -eq 1 ] && rm -f "$ROOT/e2e/$test_file"
    "$E2E_DOCKER" compose -p "$project" --project-directory "$work" "${files[@]}" \
      --profile "*" down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$work"
  }
  trap cleanup_one RETURN
  rm -rf "$rdir"; mkdir -p "$rdir"
  if [ $custom -eq 1 ]; then
    mkdir -p "$ROOT/e2e/custom"
    cp "$spec" "$ROOT/e2e/$test_file"
  fi
  local started=$SECONDS
  local before
  before=$(list_e2e_projects || true)

  # Copy the reader's setup, then swap in the start fixture.
  (cd "$ROOT/setup" && tar cf - --exclude 'data.db*' .) | (cd "$work" && tar xf -)
  cp "$ROOT/$(fixture_file "$fixture")" "$work/config.yaml"

  local profile_args=()
  if [ -n "$profiles" ]; then
    IFS=',' read -ra ps <<<"$profiles"
    for p in "${ps[@]}"; do profile_args+=(--profile "$p"); done
  fi

  echo "=== $id (fixture: $fixture, expect: $expect, profiles: ${profiles:-none})"
  local up_rc=0
  env UID="$(id -u)" GID="$(id -g)" "$E2E_DOCKER" compose -p "$project" --project-directory "$work" \
    "${files[@]}" ${profile_args[@]+"${profile_args[@]}"} --progress quiet up -d --quiet-pull || up_rc=$?
  if [ $up_rc -ne 0 ]; then
    echo "compose up failed (exit $up_rc)" >&2
    cleanup_one
    trap - RETURN
    leftover_check "$project" "$before"
    echo "status=fail rc=1 duration=$((SECONDS - started)) tests=0 skipped=0 fixture=$fixture expect=$expect profiles=${profiles:--} leftover=$LEFTOVER_N reason=compose up failed" > "$rdir/outcome"
    echo "=== $id: FAIL (rc=1)"
    return 1
  fi

  local gw net
  gw=$("$E2E_DOCKER" compose -p "$project" --project-directory "$work" "${files[@]}" ps -q agentgateway)
  net="$gw"
  [ "$restarts" = gateway ] && net=$("$E2E_DOCKER" compose -p "$project" --project-directory "$work" "${files[@]}" ps -q netns)

  # The container runs the test, then summarises the Playwright JSON into $rdir/outcome-parse
  # (unless the host parses it, E2E_OUTCOME_ON_HOST=1), then compares the final config.
  local json_in_container="$cdir/playwright.json"
  local parse_cmd="node lib/outcome.mjs '$json_in_container' > '$cdir/outcome-parse'"
  [ "${E2E_OUTCOME_ON_HOST:-0}" = 1 ] && parse_cmd=true
  set +e
  "$E2E_DOCKER" run --rm --network "container:$net" \
    -v "$ROOT:/repo" -v "$rdir:$cdir" -v "$work:/work" ${custom_mount[@]+"${custom_mount[@]}"} ${docker_args[@]+"${docker_args[@]}"} -w /repo/e2e \
    ${custom_env[@]+"${custom_env[@]}"} \
    -e UPDATE_SCREENSHOTS="$UPDATE" -e HAS_ANTHROPIC="$HAS_ANTHROPIC" -e HAS_AWS="$HAS_AWS" -e HAS_BEDROCK_KEY="$HAS_BEDROCK_KEY" -e HAS_TYPESAFE="$HAS_TYPESAFE" \
    -e HAS_CLAUDE_OAUTH="$HAS_CLAUDE_OAUTH" -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" -e LAB_FIXTURE="$fixture" \
    -e COMPOSE_PROJECT="$project" -e NPM_CONFIG_UPDATE_NOTIFIER=false -e PW_OUTPUT_DIR="$pw_out" \
    -e PLAYWRIGHT_JSON_OUTPUT_NAME="$json_in_container" \
    "$PW_IMAGE" bash -c "
      for i in \$(seq 1 60); do curl -sf localhost:15000/api/runtime >/dev/null && break; sleep 1; done
      npx playwright test '$test_file' --reporter=list,json; t=\$?
      $parse_cmd
      [ \$t -eq 0 ] || exit 1
      node lib/compare.mjs /work/config.yaml '/repo/$(fixture_file "$expect")' || exit 2
    "
  local rc=$?
  set -e
  # Keep the final config for writing fixtures and debugging.
  mkdir -p "$(dirname "$last_cfg")"
  cp "$work/config.yaml" "$last_cfg"
  if [ $rc -ne 0 ]; then
    "$E2E_DOCKER" logs "$gw" > "$rdir/gateway.log" 2>&1 || true
    echo "--- gateway log (last 40 lines)"
    tail -n 40 "$rdir/gateway.log" | cut -c1-300
  fi

  cleanup_one
  trap - RETURN
  leftover_check "$project" "$before"
  local leftover=$LEFTOVER_N

  [ "${E2E_OUTCOME_ON_HOST:-0}" = 1 ] && node "$ROOT/e2e/lib/outcome.mjs" "$rdir/playwright.json" > "$rdir/outcome-parse"
  local parsed tests skipped first_failure reason=""
  parsed=$(cat "$rdir/outcome-parse" 2>/dev/null || echo "tests=0 skipped=0 failed=0 first_failure=-")
  # first_failure is free text and last, so read the counts only from the part before it.
  local counts="${parsed%% first_failure=*}"
  tests=$(echo "$counts" | sed -E 's/.*tests=([0-9]+).*/\1/')
  skipped=$(echo "$counts" | sed -E 's/.*skipped=([0-9]+).*/\1/')
  first_failure="${parsed#* first_failure=}"
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

# skip_one <id>: the lab does not run; its outcome says so (status=skip reason=declined).
skip_one() {
  local id="$1" spec="$ROOT/e2e/labs/$1.spec.ts" rdir fixture expect profiles
  [ -f "$spec" ] || { echo "no spec: $spec" >&2; return 1; }
  fixture=$(header "$spec" fixture base)
  expect=$(header "$spec" expect "$fixture")
  profiles=$(header "$spec" profiles "")
  rdir="$WORK_ROOT/$(echo "$id" | tr '/' '-')"
  # A fresh dir, so no playwright.json from an earlier run reaches the report.
  rm -rf "$rdir"; mkdir -p "$rdir"
  echo "status=skip rc=0 duration=0 tests=0 skipped=0 fixture=$fixture expect=$expect profiles=${profiles:--} leftover=0 reason=declined" > "$rdir/outcome"
  echo "=== $id: SKIP (declined)"
}

is_skipped() { local s; for s in ${SKIPS[@]+"${SKIPS[@]}"}; do [ "$s" = "$1" ] && return 0; done; return 1; }

# leftover_check <own project> <projects listed before the run>: lists again after cleanup.
# A project still listed that is this run's own, or was not there before, prints LEFTOVER PROJECT and
# counts in LEFTOVER_N. A project listed before and after, not ours, prints PRE-EXISTING PROJECT and does not count.
# The learning gateway (agw-e2e-learn) is adapt's, started and stopped with --learn: no run makes it,
# so it never counts, even when it starts during the run.
LEFTOVER_N=0
leftover_check() {
  local own="$1" before="$2" name
  LEFTOVER_N=0
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    if [ "$name" = agw-e2e-learn ] && [ "$own" != agw-e2e-learn ]; then
      echo "LEARNING GATEWAY: agw-e2e-learn (not this run's; stop it with e2e/run-e2e.sh --learn <name> --stop)"
    elif [ "$name" = "$own" ] || ! printf '%s\n' "$before" | grep -qxF -- "$name"; then
      echo "LEFTOVER PROJECT: $name"
      LEFTOVER_N=$((LEFTOVER_N + 1))
    else
      echo "PRE-EXISTING PROJECT: $name"
    fi
  done < <(list_e2e_projects || true)
}

# lab_path <id>: the lab's markdown file relative to the repo root.
# The lab a spec documents: its first line is "// <lab>.md" (see e2e/lib/lab.ts labMarkdown).
lab_path() {
  local first
  first=$(head -1 "$ROOT/e2e/labs/$1.spec.ts" 2>/dev/null | sed -n 's|^// \([^ ]*\.md\).*|\1|p')
  echo "${first:-labs/$1.md}"
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

if [ -n "$LEARN" ]; then
  # The learning files live in custom-labs/<name>/.work/learn/; an absolute root, so Compose and Docker get absolute paths.
  mkdir -p "$CUSTOM_ROOT" && CUSTOM_ROOT="$(cd "$CUSTOM_ROOT" && pwd)"
  # shellcheck source=lib/learn.sh
  source "$ROOT/e2e/lib/learn.sh"
  learn_main "$LEARN" "$LEARN_ACTION" "$LEARN_PROFILES"
  exit $?
fi

if [ -n "$TRACK" ]; then
  ids=()
  while IFS= read -r id; do ids+=("$id"); done < <(order_ids "$TRACK")
  # Every --skip must name an id of the track, so a typo does not run the lab it meant to skip.
  for s in ${SKIPS[@]+"${SKIPS[@]}"}; do
    printf '%s\n' ${ids[@]+"${ids[@]}"} | grep -qxF -- "$s" || { echo "--skip $s: not a lab of track $TRACK" >&2; exit 64; }
  done
  for id in ${ids[@]+"${ids[@]}"}; do is_skipped "$id" || { prepare_run; break; }; done
  failed=(); nskip=0
  for id in ${ids[@]+"${ids[@]}"}; do
    if is_skipped "$id"; then skip_one "$id"; nskip=$((nskip + 1)); continue; fi
    run_one "$id" || failed+=("$id")
  done
  echo
  if [ ${#failed[@]} -eq 0 ]; then
    echo "ALL PASS ($((${#ids[@]} - nskip)) labs$([ $nskip -gt 0 ] && echo ", $nskip skipped"))"
  else echo "FAILED: ${failed[*]}"; exit 1; fi
elif [ -n "$CUSTOM" ]; then
  prepare_run
  # --update-screenshots moves the lab's PNGs aside first, so a shot the spec no longer takes does not linger.
  # They come back, replacing anything the run wrote, unless the run passes.
  IMAGES="$CUSTOM_ROOT/$CUSTOM/images"
  SHOTS_BAK=""; SHOTS_OK=0
  custom_exit() {
    rm -f "$ROOT/e2e/custom/$CUSTOM.spec.ts"
    [ -n "$SHOTS_BAK" ] && [ -d "$SHOTS_BAK" ] || return 0
    if [ "$SHOTS_OK" = 1 ]; then rm -rf "$SHOTS_BAK"; return 0; fi
    find "$IMAGES" -maxdepth 1 -name '*.png' -delete
    find "$SHOTS_BAK" -maxdepth 1 -name '*.png' -exec mv {} "$IMAGES/" \;
    rm -rf "$SHOTS_BAK"
    echo "the run did not pass: custom-labs/$CUSTOM/images/ holds the screenshots from before it" >&2
  }
  # The copy of the spec must not outlive the run, even when the run stops early.
  trap custom_exit EXIT
  if [ "$UPDATE" = 1 ]; then
    mkdir -p "$IMAGES"
    SHOTS_BAK="$CUSTOM_ROOT/$CUSTOM/.work/shots-before"
    if [ -d "$SHOTS_BAK" ]; then
      # A run that was killed before it could restore left these; they are the last good screenshots.
      find "$IMAGES" -maxdepth 1 -name '*.png' -delete
      find "$SHOTS_BAK" -maxdepth 1 -name '*.png' -exec mv {} "$IMAGES/" \;
    fi
    rm -rf "$SHOTS_BAK"; mkdir -p "$SHOTS_BAK"
    find "$IMAGES" -maxdepth 1 -name '*.png' -exec mv {} "$SHOTS_BAK/" \;
  fi
  rc=0
  run_one "custom/$CUSTOM" || rc=$?
  [ $rc -eq 0 ] && SHOTS_OK=1
  exit $rc
else
  for s in ${SKIPS[@]+"${SKIPS[@]}"}; do
    [ "$s" = "$TARGET" ] || { echo "--skip $s: this run covers only $TARGET" >&2; exit 64; }
  done
  if is_skipped "$TARGET"; then skip_one "$TARGET"; exit $?; fi
  prepare_run
  run_one "$TARGET" || exit $?
fi
