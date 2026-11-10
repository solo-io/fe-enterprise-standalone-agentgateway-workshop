# Shared stubs for the run-e2e.sh tests. Source this file; it needs TMP (a temp dir) and E2E (the e2e dir).
#
#   make_stubs            writes $TMP/stubs/{docker,curl} and $TMP/fixtures-pw/*.json
#   new_runner_repo <n>   a repo copy under $TMP/<n> holding the runner, its libs, README.md, specs and a setup dir
#   run_runner <repo> <args...>   runs the copied runner with the stubs on PATH; sets OUT and RC
#
# The docker stub appends its argv, one call per line, to $DOCKER_LOG. It answers:
#   compose ls        first call per run: $STUB_COMPOSE_LS_BEFORE, later calls: $STUB_COMPOSE_LS_AFTER,
#                     each falling back to $STUB_COMPOSE_LS (default [])
#   compose ps -q     a fake container id
#   run               writes a canned playwright.json to the host side of the -v that holds the
#                     JSON output path, then exits $STUB_PW_RC (default 0); $STUB_PW_JSON names the canned file
#   logs              a line of fake gateway log
#   anything else     exit 0
# Tests set E2E_OUTCOME_ON_HOST=1 so the runner parses the JSON with the host's node.

make_stubs() {
  mkdir -p "$TMP/stubs" "$TMP/fixtures-pw"
  cp "$E2E/tests/fixtures/playwright/"*.json "$TMP/fixtures-pw/"
  cat > "$TMP/stubs/curl" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do [ "$a" = -w ] && { printf 200; exit 0; }; done
exit 0
STUB
  cat > "$TMP/stubs/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_LOG:-/dev/null}"
case "$1" in
  compose)
    case " $* " in
      *" ls "*)
        n=$(cat "$TMP_PW/lscount" 2>/dev/null || echo 0); echo $((n + 1)) > "$TMP_PW/lscount"
        if [ "$n" -eq 0 ]; then echo "${STUB_COMPOSE_LS_BEFORE:-${STUB_COMPOSE_LS:-[]}}"
        else echo "${STUB_COMPOSE_LS_AFTER:-${STUB_COMPOSE_LS:-[]}}"; fi ;;
      *" ps -q "*) echo fakecontainerid ;;
    esac ;;
  logs) echo "fake gateway log line" ;;
  run)
    out=""; hostdir=""
    for a in "$@"; do
      case "$a" in PLAYWRIGHT_JSON_OUTPUT_NAME=*) out="${a#*=}" ;; esac
    done
    if [ -n "$out" ]; then
      for a in "$@"; do
        case "$a" in *:"$(dirname "$out")") hostdir="${a%%:*}" ;; esac
      done
      [ -n "$hostdir" ] && cp "${STUB_PW_JSON:-$TMP_PW/pass.json}" "$hostdir/$(basename "$out")"
    fi
    exit "${STUB_PW_RC:-0}" ;;
esac
exit 0
STUB
  chmod +x "$TMP/stubs/curl" "$TMP/stubs/docker"
}

new_runner_repo() {
  local d="$TMP/$1"
  mkdir -p "$d/e2e/lib" "$d/e2e/fixtures" "$d/e2e/node_modules/@playwright/test" "$d/setup"
  cp "$E2E/run-e2e.sh" "$d/e2e/"
  cp "$E2E/lib/"*.sh "$E2E/lib/"*.mjs "$d/e2e/lib/" 2>/dev/null
  cp "$E2E/compose.e2e.yaml" "$E2E/compose.e2e-restart.yaml" "$d/e2e/"
  cp -R "$E2E/labs" "$d/e2e/labs"
  cp "$E2E/../README.md" "$d/README.md"
  cp -R "$E2E/../labs" "$d/labs"
  printf 'a: 1\n' > "$d/setup/config.yaml"
  : > "$d/setup/docker-compose.yml"
  printf 'OPENAI_API_KEY=sk-fake\n' > "$d/setup/.env"
  echo "$d"
}

run_runner() {
  local d="$1"; shift
  : > "$TMP/docker.log"; rm -f "$TMP/fixtures-pw/lscount"
  RC=0
  OUT=$(cd "$d" && env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u TYPESAFE_AI_API_KEY -u AWS_ACCESS_KEY_ID \
    -u BEDROCK_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN \
    PATH="$TMP/stubs:$(dirname "$(command -v node)"):/usr/bin:/bin" E2E_CURL="$TMP/stubs/curl" \
    E2E_DOCKER="$TMP/stubs/docker" DOCKER_LOG="$TMP/docker.log" TMP_PW="$TMP/fixtures-pw" \
    E2E_OUTCOME_ON_HOST=1 E2E_WORK_ROOT="$d/work" TMPDIR="$TMP" \
    bash e2e/run-e2e.sh "$@" 2>&1) || RC=$?
}
