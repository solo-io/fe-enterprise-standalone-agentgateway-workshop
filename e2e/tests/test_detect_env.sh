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

STUBS="$TMP/stubs"; mkdir -p "$STUBS"
cat > "$STUBS/curl" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do [ "$a" = -w ] && { printf 200; exit 0; }; done
case "$*" in
  *localhost:15000/api/runtime*) printf '{"build":{"version":"v2026.10.0"}}' ;;
esac
exit 0
STUB
cat > "$TMP/docker.stub" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  "version --format {{.Server.Version}}") echo 27.0.1 ;;
  "compose version --short") echo 2.29.0 ;;
  "image inspect "*) exit 0 ;;
  "compose ls --format json") echo "${STUB_COMPOSE_LS:-[]}" ;;
  *) exit 1 ;;
esac
STUB
chmod +x "$STUBS/curl" "$TMP/docker.stub"

# new_repo <name>: a git repo copy holding the scripts under test and a setup/.env with fake keys.
new_repo() {
  local d="$TMP/$1"
  mkdir -p "$d/e2e/lib" "$d/setup"
  cp "$E2E/lib/detect-env.sh" "$E2E/lib/keys.sh" "$d/e2e/lib/" 2>/dev/null
  cp "$REPO/setup/.env.example" "$d/setup/.env"
  printf 'a: 1\n' > "$d/setup/config.yaml"
  (cd "$d" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init)
  echo "$d"
}
# run_detect <repo> <with-docker 1|0>: sets OUT and RC.
run_detect() {
  local d="$1" withdocker="$2" bin="$TMP/bin-$1"
  rm -rf "$bin"; mkdir -p "$bin"; cp "$STUBS/curl" "$bin/curl"
  [ "$withdocker" = 1 ] && cp "$TMP/docker.stub" "$bin/docker"
  RC=0
  OUT=$(cd "$d" && PATH="$bin:/usr/bin:/bin" E2E_CURL="$bin/curl" bash e2e/lib/detect-env.sh 2>&1) || RC=$?
}
has() { grep -qF -- "$2" "$1"; }

d=$(new_repo all); run_detect "$d" 1; J="$d/e2e/.work/env.json"
[ "$RC" -eq 0 ]; check "all present: exit 0 (rc=$RC)" $?
has "$J" '"user_gateway": {"state":"running","version":"v2026.10.0"}'; check "all present: user gateway running" $?
has "$J" '"setup_config_dirty": false'; check "all present: config not dirty" $?
has "$J" '"playwright_image": "present"'; check "all present: image present" $?
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

printf '\n%s passed, %s failed\n' "$T_PASS" "$T_FAIL"
[ "$T_FAIL" -eq 0 ]
