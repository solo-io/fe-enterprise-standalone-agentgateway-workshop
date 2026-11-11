#!/usr/bin/env bash
# Tests for lib/detect-env.sh against a temp repo copy with stub docker and curl.
E2E="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$E2E/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
T_PASS=0; T_FAIL=0
check() { # check <name> <condition-exit-code>
  if [ "$2" -eq 0 ]; then T_PASS=$((T_PASS+1)); printf 'ok   %s\n' "$1"
  else T_FAIL=$((T_FAIL+1)); printf 'FAIL %s\n' "$1"; fi
}

# Keys exported in the developer shell must not leak into the cases.
unset OPENAI_API_KEY ANTHROPIC_API_KEY TYPESAFE_AI_API_KEY AWS_ACCESS_KEY_ID BEDROCK_API_KEY CLAUDE_CODE_OAUTH_TOKEN

STUBS="$TMP/stubs"; mkdir -p "$STUBS"
cat > "$STUBS/curl" <<'STUB'
#!/usr/bin/env bash
# STUB_OPENAI_CODE and STUB_RUNTIME_CODE (default 200) set the status for each endpoint.
case "$*" in
  *localhost:15000/api/runtime*)
    code="${STUB_RUNTIME_CODE:-200}"
    [ "$code" = 200 ] && printf '%s' "${STUB_RUNTIME_BODY-{\"build\":{\"version\":\"v2026.10.0\"}}}"
    printf '\n%s' "$code"; exit 0 ;;
  *api.openai.com*) printf '%s' "${STUB_OPENAI_CODE:-200}"; exit 0 ;;
esac
for a in "$@"; do [ "$a" = -w ] && { printf 200; exit 0; }; done
exit 0
STUB
cat > "$TMP/docker.stub" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  "version --format {{.Server.Version}}") echo 27.0.1 ;;
  "compose version --short") echo 2.29.0 ;;
  "image inspect "*) exit 0 ;;
  "compose ls -a --format json") echo "${STUB_COMPOSE_LS:-[]}" ;;
  *) exit 1 ;;
esac
STUB
printf '#!/usr/bin/env bash\necho "Python 3.12.1"\n' > "$STUBS/python3"
printf '#!/usr/bin/env bash\necho "jq-1.7.1"\n' > "$STUBS/jq"
printf '#!/usr/bin/env bash\necho "gh version 2.50.0 (2026-01-01)"\necho "https://github.com/cli/cli"\n' > "$STUBS/gh"
chmod +x "$STUBS/curl" "$STUBS/python3" "$STUBS/jq" "$STUBS/gh" "$TMP/docker.stub"

# new_repo <name>: a git repo copy holding the scripts under test and a setup/.env with fake keys.
new_repo() {
  local d="$TMP/$1"
  mkdir -p "$d/e2e/lib" "$d/setup"
  cp "$E2E/lib/detect-env.sh" "$E2E/lib/keys.sh" "$E2E/lib/playwright-mcp.sh" "$d/e2e/lib/" 2>/dev/null
  cp "$REPO/setup/.env.example" "$d/setup/.env"
  printf 'a: 1\n' > "$d/setup/config.yaml"
  (cd "$d" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init)
  echo "$d"
}
# run_detect <repo> <with-docker 1|0>: sets OUT and RC.
run_detect() {
  local d="$1" withdocker="$2" bin="$TMP/bin-$(basename "$1")" f
  rm -rf "$bin"; mkdir -p "$bin"
  # Symlink the system tools except the ones under test: CI runners ship real docker and gh in /usr/bin.
  for f in /usr/bin/* /bin/*; do case "$(basename "$f")" in curl|docker|gh|python3|jq) continue ;; esac; ln -sf "$f" "$bin/$(basename "$f")" 2>/dev/null; done
  cp "$STUBS/curl" "$bin/curl"
  cp "$STUBS/python3" "$STUBS/jq" "$bin/"
  [ -z "${WITH_GH:-}" ] || cp "$STUBS/gh" "$bin/gh"
  [ "$withdocker" = 1 ] && cp "$TMP/docker.stub" "$bin/docker"
  RC=0
  OUT=$(cd "$d" && PATH="$bin" E2E_CURL="$bin/curl" bash e2e/lib/detect-env.sh 2>&1) || RC=$?
}
has() { grep -qF -- "$2" "$1"; }

d=$(new_repo all); run_detect "$d" 1; J="$d/e2e/.work/env.json"
[ "$RC" -eq 0 ]; check "all present: exit 0 (rc=$RC)" $?
has "$J" '"user_gateway": {"state":"running","version":"v2026.10.0"}'; check "all present: user gateway running" $?
has "$J" '"setup_config_dirty": false'; check "all present: config not dirty" $?
has "$J" '"playwright_image": "present"'; check "all present: image present" $?
has "$J" '"playwright_mcp_image": "present"'; check "all present: Playwright MCP image present" $?
has "$J" '"OPENAI_API_KEY": "ok"'; check "all present: openai key ok" $?
case "$OUT" in *"docker: 27.0.1"*) r=0 ;; *) r=1 ;; esac; check "all present: prints key: value lines" $r

d=$(new_repo nodocker); run_detect "$d" 0
[ "$RC" -eq 2 ]; check "no docker: exit 2 (rc=$RC)" $?
case "$OUT" in *"docker: absent"*) r=0 ;; *) r=1 ;; esac; check "no docker: says docker: absent" $r

d=$(new_repo noenv); rm "$d/setup/.env"; run_detect "$d" 1
[ "$RC" -eq 2 ]; check "no env file: exit 2 (rc=$RC)" $?
case "$OUT" in *"setup/.env"*) r=0 ;; *) r=1 ;; esac; check "no env file: names setup/.env" $r

d=$(new_repo dirty); echo "# x" >> "$d/setup/config.yaml"; run_detect "$d" 1
[ "$RC" -eq 0 ]; check "dirty config: exit 0 (rc=$RC)" $?
has "$d/e2e/.work/env.json" '"setup_config_dirty": true'; check "dirty config: flagged" $?

d=$(new_repo nogit); rm -rf "$d/.git"; run_detect "$d" 1
has "$d/e2e/.work/env.json" '"setup_config_dirty": false'; check "no .git: not dirty" $?

d=$(new_repo left)
export STUB_COMPOSE_LS='[{"Name":"agw-e2e-llm-x"},{"Name":"other"}]'
run_detect "$d" 1; unset STUB_COMPOSE_LS
has "$d/e2e/.work/env.json" '"leftover_projects": ["agw-e2e-llm-x"]'; check "leftover projects: only agw-e2e-* listed" $?
export STUB_COMPOSE_LS='[{"Name": "agw-e2e-spaced"}]'
run_detect "$d" 1; unset STUB_COMPOSE_LS
has "$d/e2e/.work/env.json" '"leftover_projects": ["agw-e2e-spaced"]'; check "leftover projects: JSON with a space after the colon" $?

d=$(new_repo staged); echo "# x" >> "$d/setup/config.yaml"; git -C "$d" add setup/config.yaml; run_detect "$d" 1
has "$d/e2e/.work/env.json" '"setup_config_dirty": true'; check "staged edit: dirty" $?

d=$(new_repo wt); git -C "$d" worktree add -q "$TMP/wtree" -b wtb 2>/dev/null
mkdir -p "$TMP/wtree/e2e/lib"; cp "$d/e2e/lib/"*.sh "$TMP/wtree/e2e/lib/"; cp "$d/setup/.env" "$TMP/wtree/setup/.env"
echo "# x" >> "$TMP/wtree/setup/config.yaml"; run_detect "$TMP/wtree" 1
has "$TMP/wtree/e2e/.work/env.json" '"setup_config_dirty": true'; check "worktree: dirty detected" $?

d=$(new_repo gitbad); echo "ref: refs/heads/nope" > "$d/.git/HEAD"; run_detect "$d" 1
has "$d/e2e/.work/env.json" '"setup_config_dirty": false' && has "$d/e2e/.work/env.json" '"setup_config_dirty_error"'; check "git error: not dirty, error recorded" $?

d=$(new_repo badkey); echo "ANTHROPIC_API_KEY=sk-x" >> "$d/setup/.env"; STUB_OPENAI_CODE=401 run_detect "$d" 1
[ "$RC" -eq 2 ]; check "rejected openai key: exit 2 (rc=$RC)" $?
case "$OUT" in *OPENAI_API_KEY*rejected*) r=0 ;; *) r=1 ;; esac; check "rejected openai key: line names OPENAI_API_KEY" $r
has "$d/e2e/.work/env.json" '"OPENAI_API_KEY": "rejected"'; check "rejected openai key: status rejected" $?
has "$d/e2e/.work/env.json" '"ANTHROPIC_API_KEY": "ok"'; check "rejected openai key: other keys still checked" $?

d=$(new_repo nokey); sed -i.bak '/^OPENAI_API_KEY=/d' "$d/setup/.env"; run_detect "$d" 1
[ "$RC" -eq 2 ]; check "openai key missing: exit 2 (rc=$RC)" $?
has "$d/e2e/.work/env.json" '"OPENAI_API_KEY": "missing"'; check "openai key missing: status missing" $?

d=$(new_repo gw404); STUB_RUNTIME_CODE=404 run_detect "$d" 1
[ "$RC" -eq 0 ]; check "runtime 404: exit 0 (rc=$RC)" $?
has "$d/e2e/.work/env.json" '"user_gateway": {"state":"absent"}'; check "runtime 404: gateway absent" $?
d=$(new_repo gwdown); STUB_RUNTIME_CODE=000 run_detect "$d" 1
has "$d/e2e/.work/env.json" '"user_gateway": {"state":"absent"}'; check "connection refused: gateway absent" $?
d=$(new_repo gwjunk); STUB_RUNTIME_BODY='<html>' run_detect "$d" 1
has "$d/e2e/.work/env.json" '"user_gateway": {"state":"absent"}'; check "200 without build.version: gateway absent" $?

# run_detect_without <repo> <tool>: PATH holds every /usr/bin and /bin tool except <tool>, plus the stubs.
run_detect_without() {
  local d="$1" tool="$2" bin="$TMP/binx-$(basename "$1")" f
  rm -rf "$bin"; mkdir -p "$bin"
  for f in /usr/bin/* /bin/*; do case "$(basename "$f")" in "$tool"|curl|docker|python3|jq) continue ;; esac; ln -sf "$f" "$bin/$(basename "$f")" 2>/dev/null; done
  cp "$STUBS/curl" "$bin/curl"; cp "$TMP/docker.stub" "$bin/docker"
  [ "$tool" = python3 ] || cp "$STUBS/python3" "$bin/"
  [ "$tool" = jq ] || cp "$STUBS/jq" "$bin/"
  RC=0
  OUT=$(cd "$d" && PATH="$bin" E2E_CURL="$bin/curl" bash e2e/lib/detect-env.sh 2>&1) || RC=$?
}

d=$(new_repo tools); run_detect "$d" 1
has "$d/e2e/.work/env.json" '"python3": "Python 3.12.1"' && has "$d/e2e/.work/env.json" '"jq": "jq-1.7.1"'; check "tools: python3 and jq versions recorded" $?
has "$d/e2e/.work/env.json" '"gh": "absent"'; check "tools: gh absent recorded" $?
[ "$RC" -eq 0 ]; check "tools: gh absent still exits 0 (rc=$RC)" $?
d=$(new_repo ghin); WITH_GH=1 run_detect "$d" 1
has "$d/e2e/.work/env.json" '"gh": "gh version 2.50.0 (2026-01-01)"'; check "tools: gh version is the first line" $?
d=$(new_repo nopy); run_detect_without "$d" python3
[ "$RC" -eq 2 ]; check "no python3: exit 2 (rc=$RC)" $?
case "$OUT" in *"missing: python3"*) r=0 ;; *) r=1 ;; esac; check "no python3: names python3" $r
has "$d/e2e/.work/env.json" '"python3": "absent"'; check "no python3: recorded absent" $?
d=$(new_repo nojq); run_detect_without "$d" jq
[ "$RC" -eq 2 ]; check "no jq: exit 2 (rc=$RC)" $?
case "$OUT" in *"missing: jq"*) r=0 ;; *) r=1 ;; esac; check "no jq: names jq" $r

printf '\n%s passed, %s failed\n' "$T_PASS" "$T_FAIL"
[ "$T_FAIL" -eq 0 ]
