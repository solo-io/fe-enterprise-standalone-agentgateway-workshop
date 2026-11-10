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
STUB_COMPOSE_LS_BEFORE='[]' STUB_COMPOSE_LS_AFTER='[{"Name":"agw-e2e-llm-x","Status":"running(1)"}]' run_runner "$REPO" llm/virtual-api-keys
check "leftover ours: line" $(has "LEFTOVER PROJECT: agw-e2e-llm-x" && echo 0 || echo 1)
check "leftover ours: exit 1" $([ "$RC" -eq 1 ] && echo 0 || echo 1)
check "leftover ours: leftover=1 and fail" $(outcome llm-virtual-api-keys | grep -q '^status=fail rc=0 .*leftover=1 reason=leftover projects remain$' && echo 0 || echo 1)
STUB_COMPOSE_LS='[{"Name":"agw-e2e-old"}]' run_runner "$REPO" llm/virtual-api-keys
check "pre-existing only: run passes" $([ "$RC" -eq 0 ] && echo 0 || echo 1)
check "pre-existing only: line printed once" $([ "$(printf '%s\n' "$OUT" | grep -cF 'PRE-EXISTING PROJECT: agw-e2e-old')" -eq 1 ] && echo 0 || echo 1)
check "pre-existing only: no LEFTOVER line, leftover=0" $(! has "LEFTOVER PROJECT:" && outcome llm-virtual-api-keys | grep -q 'leftover=0' && echo 0 || echo 1)
STUB_COMPOSE_LS_BEFORE='[{"Name":"agw-e2e-old"}]' STUB_COMPOSE_LS_AFTER='[{"Name":"agw-e2e-old"},{"Name":"agw-e2e-llm-virtual-api-keys"}]' run_runner "$REPO" llm/virtual-api-keys
check "old plus own: only own is leftover" $(has "LEFTOVER PROJECT: agw-e2e-llm-virtual-api-keys" && ! has "LEFTOVER PROJECT: agw-e2e-old" && has "PRE-EXISTING PROJECT: agw-e2e-old" && outcome llm-virtual-api-keys | grep -q 'leftover=1' && echo 0 || echo 1)
check "old plus own: exit 1" $([ "$RC" -eq 1 ] && echo 0 || echo 1)

# a failing title that looks like outcome fields must not corrupt the counts
STUB_PW_RC=1 STUB_PW_JSON="$TMP/fixtures-pw/trap.json" run_runner "$REPO" llm/virtual-api-keys
check "trap title: counts intact" $(outcome llm-virtual-api-keys | grep -q ' tests=2 skipped=0 ' && echo 0 || echo 1)
check "trap title: reason is the full title" $(outcome llm-virtual-api-keys | grep -qF 'reason=[R1] tests=9 skipped=3 trap' && echo 0 || echo 1)

# --track runs several ids and reports failures
STUB_PW_RC=1 STUB_PW_JSON="$TMP/fixtures-pw/fail.json" run_runner "$REPO" --track platform
check "track run lists failures" $(has "FAILED: platform/" && echo 0 || echo 1)
check "track run goes on after a failure" $([ "$(printf '%s\n' "$OUT" | grep -c '^=== platform/.*: FAIL')" -gt 1 ] && echo 0 || echo 1)

# custom labs
CF="$E2E/tests/fixtures/custom-labs"
mkdir -p "$REPO/custom-labs"; cp -R "$CF/demo" "$REPO/custom-labs/demo"
cp "$E2E/lint.sh" "$E2E/check-ports.sh" "$REPO/e2e/"
export STUB_PW_JSON="$TMP/fixtures-pw/pass.json" STUB_PW_RC=0 STUB_COMPOSE_LS='[]'
run_runner "$REPO" --custom Bad_Name
check "custom bad name: exit 64 and mentions name" $([ "$RC" -eq 64 ] && has "name" && echo 0 || echo 1)
run_runner "$REPO" --custom nothere
check "custom missing files: exit 1 and names paths" $([ "$RC" -eq 1 ] && has "custom-labs/nothere/nothere.md" && has "custom-labs/nothere/nothere.spec.ts" && echo 0 || echo 1)
run_runner "$REPO" --custom demo
check "custom run passes" $([ "$RC" -eq 0 ] && echo 0 || echo 1)
check "custom copy removed after run" $([ ! -e "$REPO/e2e/custom/demo.spec.ts" ] && echo 0 || echo 1)
check "custom run argv has PW_TEST_DIR, LAB_IMAGES_DIR and the test file" $(grep -qF -- '-e PW_TEST_DIR=custom' "$TMP/docker.log" && grep -qF -- '-e LAB_IMAGES_DIR=/repo/custom-labs/demo/images' "$TMP/docker.log" && grep -qF 'custom/demo.spec.ts' "$TMP/docker.log" && echo 0 || echo 1)
check "custom outcome in work/custom/demo" $(grep -q '^status=pass ' "$REPO/work/custom/demo/outcome" 2>/dev/null && echo 0 || echo 1)
STUB_PW_RC=1 STUB_PW_JSON="$TMP/fixtures-pw/fail.json" run_runner "$REPO" --custom demo
check "custom copy removed after a failed run" $([ "$RC" -eq 1 ] && [ ! -e "$REPO/e2e/custom/demo.spec.ts" ] && echo 0 || echo 1)
: > "$REPO/custom-labs/demo/images/99-stale.png"
run_runner "$REPO" --custom demo
check "custom without --update-screenshots keeps images" $([ -f "$REPO/custom-labs/demo/images/99-stale.png" ] && echo 0 || echo 1)
run_runner "$REPO" --custom demo --update-screenshots
check "custom --update-screenshots clears stale pngs" $([ ! -f "$REPO/custom-labs/demo/images/99-stale.png" ] && echo 0 || echo 1)
rm -rf "$REPO/custom-labs/demo"; cp -R "$CF/demo" "$REPO/custom-labs/demo"
run_runner "$REPO" --custom demo --lint
check "custom --lint runs lint only" $([ "$RC" -eq 0 ] && has "lint ok" && ! grep -q '^run ' "$TMP/docker.log" && echo 0 || echo 1)
mkdir -p "$TMP/croot"; cp -R "$CF/demo" "$TMP/croot/demo"
E2E_CUSTOM_ROOT="$TMP/croot" run_runner "$REPO" --custom demo
check "custom root override finds demo and mounts it" $([ "$RC" -eq 0 ] && grep '^run ' "$TMP/docker.log" | grep -qF "$TMP/croot:/repo/custom-labs" && echo 0 || echo 1)
mkdir -p "$REPO/croot-rel"; cp -R "$CF/demo" "$REPO/croot-rel/demo"
E2E_CUSTOM_ROOT=croot-rel run_runner "$REPO" --custom demo
check "relative custom root: mount is an absolute path" $([ "$RC" -eq 0 ] && grep -oE -- '-v [^ ]*:/repo/custom-labs' "$TMP/docker.log" | grep -q '^-v /' && echo 0 || echo 1)

run_runner "$REPO" --report-only
check "report-only is not built yet" $([ "$RC" -eq 2 ] && has "report builder not available yet" && echo 0 || echo 1)

printf '\n%s passed, %s failed\n' "$T_PASS" "$T_FAIL"
[ "$T_FAIL" -eq 0 ]
