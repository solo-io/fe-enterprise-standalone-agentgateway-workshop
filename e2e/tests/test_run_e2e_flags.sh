#!/usr/bin/env bash
# Tests for run-e2e.sh --list, --track, the per-run outcome line and the leftover check.
# Offline: docker and curl are stubs (see lib/stubs.sh); no container runs.
E2E="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
T_PASS=0; T_FAIL=0
check() { # check <name> <condition-exit-code>
  if [ "$2" -eq 0 ]; then T_PASS=$((T_PASS+1)); printf 'ok   %s\n' "$1"
  else T_FAIL=$((T_FAIL+1)); printf 'FAIL %s\n' "$1"; fi
}
# shellcheck source=lib/stubs.sh
source "$E2E/tests/lib/stubs.sh"
make_stubs
REPO="$(new_runner_repo r)"
has() { printf '%s\n' "$OUT" | grep -qF -- "$1"; }
outcome() { cat "$REPO/work/$1/outcome" 2>/dev/null; }
# data lines of --list: the tab-separated ones
ids() { printf '%s\n' "$OUT" | awk -F'\t' 'NF==3 {print $1}'; }

# list: track llm
run_runner "$REPO" --list --track llm
check "list exits 0" $((RC))
check "list first id is 001" $([ "$(ids | sed -n 1p)" = 001 ] && echo 0 || echo 1)
check "list second id is llm/connect-llm-providers" $([ "$(ids | sed -n 2p)" = llm/connect-llm-providers ] && echo 0 || echo 1)
missing=0
for f in "$REPO"/e2e/labs/llm/*.spec.ts; do
  id="llm/$(basename "$f" .spec.ts)"
  [ "$(ids | grep -cxF "$id")" -eq 1 ] || { missing=1; echo "  not listed once: $id"; }
done
check "list names every llm spec once" $missing
check "list has no mcp id" $(ids | grep -q '^mcp/' && echo 1 || echo 0)
row=$(printf '\t')
check "list data line has lab path and profiles" $(printf '%s\n' "$OUT" | grep -qF "llm/virtual-api-keys${row}labs/llm/virtual-api-keys.md${row}-" && echo 0 || echo 1)
check "list prints key-check lines after the data" $(has "ANTHROPIC_API_KEY: not set" && echo 0 || echo 1)
check "list starts nothing" $(grep -q 'compose.* up' "$TMP/docker.log" && echo 1 || echo 0)

# track order
run_runner "$REPO" --list --track mcp
check "mcp list first id" $([ "$(ids | sed -n 1p)" = mcp/connect-remote-mcp-server ] && echo 0 || echo 1)
run_runner "$REPO" --list --track platform
check "platform list is only platform ids" $(ids | grep -qv '^platform/' && echo 1 || echo 0)
run_runner "$REPO" --list
check "all list begins with the three intro ids" $([ "$(ids | sed -n 1,3p | tr '\n' ' ')" = "001 llm/connect-llm-providers mcp/connect-remote-mcp-server " ] && echo 0 || echo 1)
run_runner "$REPO" --list --track nope
check "unknown track fails" $([ "$RC" -ne 0 ] && echo 0 || echo 1)

# bad OpenAI key: list still prints, then the key error
cat > "$TMP/stubs/curl-bad" <<'STUB'
#!/usr/bin/env bash
case "$*" in *api.openai.com*) printf 401; exit 0 ;; esac
for a in "$@"; do [ "$a" = -w ] && { printf 200; exit 0; }; done
exit 0
STUB
chmod +x "$TMP/stubs/curl-bad"
SAVE="$TMP/stubs/curl"; cp "$SAVE" "$TMP/stubs/curl-good"; cp "$TMP/stubs/curl-bad" "$SAVE"
run_runner "$REPO" --list --track mcp
cp "$TMP/stubs/curl-good" "$SAVE"
check "bad openai key: list still printed" $([ "$(ids | sed -n 1p)" = mcp/connect-remote-mcp-server ] && echo 0 || echo 1)
check "bad openai key: key error shown" $(has "OPENAI_API_KEY does not work" && echo 0 || echo 1)

# run one id
export STUB_PW_JSON="$TMP/fixtures-pw/pass.json" STUB_PW_RC=0 STUB_COMPOSE_LS='[]'
run_runner "$REPO" llm/virtual-api-keys
check "unchanged single id header" $(has "=== llm/virtual-api-keys (fixture: base, expect: base, profiles: none)" && echo 0 || echo 1)
check "unchanged single id PASS line" $(has "=== llm/virtual-api-keys: PASS" && echo 0 || echo 1)
check "outcome pass" $(outcome llm-virtual-api-keys | grep -q '^status=pass rc=0 duration=[0-9]* tests=3 skipped=0 ' && echo 0 || echo 1)
check "outcome carries fixture, expect, profiles, leftover" $(outcome llm-virtual-api-keys | grep -q 'fixture=base expect=base profiles=- leftover=0' && echo 0 || echo 1)
check "playwright.json kept" $([ -f "$REPO/work/llm-virtual-api-keys/playwright.json" ] && echo 0 || echo 1)
check "json reporter requested" $(grep -q -- '--reporter=list,json' "$TMP/docker.log" && echo 0 || echo 1)
check "no gateway.log on pass" $([ ! -f "$REPO/work/llm-virtual-api-keys/gateway.log" ] && echo 0 || echo 1)

STUB_PW_JSON="$TMP/fixtures-pw/skipped.json" run_runner "$REPO" llm/virtual-api-keys
check "outcome skipped" $(outcome llm-virtual-api-keys | grep -q '^status=pass .*skipped=1 ' && echo 0 || echo 1)

STUB_PW_RC=1 STUB_PW_JSON="$TMP/fixtures-pw/fail.json" run_runner "$REPO" llm/virtual-api-keys
check "outcome fail" $(outcome llm-virtual-api-keys | grep -q '^status=fail rc=1 ' && echo 0 || echo 1)
check "outcome fail reason is the first failing test" $(outcome llm-virtual-api-keys | grep -q 'reason=\[R2\] bob is denied$' && echo 0 || echo 1)
check "gateway.log written on failure" $([ -f "$REPO/work/llm-virtual-api-keys/gateway.log" ] && echo 0 || echo 1)
check "failed run exits 1" $([ "$RC" -eq 1 ] && echo 0 || echo 1)

STUB_PW_RC=2 run_runner "$REPO" llm/virtual-api-keys
check "outcome config mismatch" $(outcome llm-virtual-api-keys | grep -q '^status=fail rc=2 .*config_mismatch=1 reason=config did not return to base$' && echo 0 || echo 1)

# leftover check
STUB_COMPOSE_LS='[]' run_runner "$REPO" llm/virtual-api-keys
check "leftover none: no line" $(has "LEFTOVER PROJECT:" && echo 1 || echo 0)
check "leftover none: leftover=0" $(outcome llm-virtual-api-keys | grep -q 'leftover=0' && echo 0 || echo 1)
STUB_COMPOSE_LS='[{"Name":"keycloak"}]' run_runner "$REPO" llm/virtual-api-keys
check "leftover other prefix: no line" $(has "LEFTOVER PROJECT:" && echo 1 || echo 0)
STUB_COMPOSE_LS='[{"Name":"agw-e2e-llm-x","Status":"running(1)"}]' run_runner "$REPO" llm/virtual-api-keys
check "leftover ours: line" $(has "LEFTOVER PROJECT: agw-e2e-llm-x" && echo 0 || echo 1)
check "leftover ours: exit 1" $([ "$RC" -eq 1 ] && echo 0 || echo 1)
check "leftover ours: leftover=1 and fail" $(outcome llm-virtual-api-keys | grep -q '^status=fail rc=0 .*leftover=1 reason=leftover projects remain$' && echo 0 || echo 1)

# --track runs several ids and reports failures
STUB_PW_RC=1 STUB_PW_JSON="$TMP/fixtures-pw/fail.json" run_runner "$REPO" --track platform
check "track run lists failures" $(has "FAILED: platform/" && echo 0 || echo 1)
check "track run goes on after a failure" $([ "$(printf '%s\n' "$OUT" | grep -c '^=== platform/.*: FAIL')" -gt 1 ] && echo 0 || echo 1)

run_runner "$REPO" --report-only
check "report-only is not built yet" $([ "$RC" -eq 2 ] && has "report builder not available yet" && echo 0 || echo 1)

printf '\n%s passed, %s failed\n' "$T_PASS" "$T_FAIL"
[ "$T_FAIL" -eq 0 ]
