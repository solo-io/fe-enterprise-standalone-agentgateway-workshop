#!/usr/bin/env bash
# Tests for run-e2e.sh --learn: the learning gateway for adapt (lib/learn.sh, lib/learn-diff.mjs).
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
cat > "$REPO/setup/docker-compose.yml" <<'YAML'
services:
  agentgateway:
    image: gw
  mock-llm:
    profiles: [mock-llm]
  postgres:
    profiles: [postgres]
YAML
printf 'config:\n  adminAddr: 0.0.0.0:15000\nllm:\n  port: 4000\n' > "$REPO/setup/config.yaml"
: > "$REPO/setup/data.db"
has() { printf '%s\n' "$OUT" | grep -qF -- "$1"; }
log_has() { grep -qF -- "$1" "$TMP/docker.log"; }
A="$REPO/work/adapt/demo"
export STUB_COMPOSE_LS='[]' STUB_PW_RC=0
unset STUB_NETNS_DIR

# start
run_runner "$REPO" --learn demo --profiles mock-llm
check "start: exit 0 and LEARN READY last" $([ "$RC" -eq 0 ] && [ "$(printf '%s\n' "$OUT" | tail -1)" = "LEARN READY agw-e2e-learn" ] && echo 0 || echo 1)
check "start: project agw-e2e-learn with the restart override and no-ports override" $(grep -E 'compose .* up ' "$TMP/docker.log" | grep -F -- '-p agw-e2e-learn ' | grep -F 'compose.e2e.yaml' | grep -qF 'compose.e2e-restart.yaml' && echo 0 || echo 1)
check "start: the given profile" $(grep -E 'compose .* up ' "$TMP/docker.log" | grep -qF -- '--profile mock-llm' && echo 0 || echo 1)
check "start: waits for the gateway inside the netns" $(grep '^run ' "$TMP/docker.log" | grep -F -- '--network container:agw-e2e-learn-netns-1' | grep -qF 'localhost:15000/api/runtime' && echo 0 || echo 1)
check "start: config.before.yaml is the base fixture" $(cmp -s "$A/config.before.yaml" "$REPO/setup/config.yaml" && echo 0 || echo 1)
check "start: project dir is a setup copy without data.db" $([ -f "$A/project/docker-compose.yml" ] && [ ! -e "$A/project/data.db" ] && echo 0 || echo 1)
check "start: leaves it running (no down)" $(grep -qE 'compose .* down ' "$TMP/docker.log" && echo 1 || echo 0)
check "start: no key check" $(has "ANTHROPIC_API_KEY" && echo 1 || echo 0)

run_runner "$REPO" --learn demo
check "start without --profiles: no --profile flag" $([ "$RC" -eq 0 ] && ! grep -E 'compose .* up ' "$TMP/docker.log" | grep -qF -- '--profile' && echo 0 || echo 1)

run_runner "$REPO" --learn demo --profiles mock-llm,nope
check "start: unknown profile exits 64 before anything starts" $([ "$RC" -eq 64 ] && has "unknown compose profile: 'nope'" && [ ! -s "$TMP/docker.log" ] && echo 0 || echo 1)

STUB_COMPOSE_LS='[{"Name":"agw-e2e-learn"}]' STUB_NETNS_DIR="$REPO/work/adapt/other/project" run_runner "$REPO" --learn demo
check "start: refuses when agw-e2e-learn exists and names the stop command" $([ "$RC" -eq 1 ] && has "already exists" && has "e2e/run-e2e.sh --learn other --stop" && ! grep -qE 'compose .* up ' "$TMP/docker.log" && echo 0 || echo 1)

STUB_UP_RC=1 run_runner "$REPO" --learn demo
check "start: compose up failure exits 1 and takes the project down" $([ "$RC" -eq 1 ] && grep -E 'compose .* down ' "$TMP/docker.log" | grep -qF -- '-p agw-e2e-learn ' && [ ! -d "$A/project" ] && echo 0 || echo 1)
STUB_PW_RC=1 run_runner "$REPO" --learn demo
check "start: gateway never answers: exit 1, log shown, project down" $([ "$RC" -eq 1 ] && has "did not answer" && log_has " logs " && grep -qE 'compose .* down ' "$TMP/docker.log" && ! has "LEARN READY" && echo 0 || echo 1)

mv "$REPO/setup/.env" "$REPO/setup/.env.off"
run_runner "$REPO" --learn demo
check "start: needs setup/.env" $([ "$RC" -eq 1 ] && has "missing setup/.env" && echo 0 || echo 1)
mv "$REPO/setup/.env.off" "$REPO/setup/.env"

# diff
run_runner "$REPO" --learn demo
export STUB_NETNS_DIR="$A/project"
run_runner "$REPO" --learn demo --diff
check "diff: unchanged config exits 0 and saves config.after.yaml" $([ "$RC" -eq 0 ] && cmp -s "$A/config.after.yaml" "$A/config.before.yaml" && has "no config changes" && echo 0 || echo 1)
cat > "$A/project/config.yaml" <<'YAML'
config:
  adminAddr: 0.0.0.0:15000
llm:
  port: 4000
  models:
    - name: openai/*
      agentgateway.dev/id: abc123
YAML
run_runner "$REPO" --learn demo --diff
check "diff: changed config exits 2 and prints the changed path" $([ "$RC" -eq 2 ] && has '+ llm.models: [{"name":"openai/*"}]' && echo 0 || echo 1)
check "diff: UI metadata is ignored" $(has "abc123" && echo 1 || echo 0)
check "diff: config.after.yaml is the gateway's config" $(cmp -s "$A/config.after.yaml" "$A/project/config.yaml" && echo 0 || echo 1)
printf 'config:\n  adminAddr: 0.0.0.0:15000\nllm:\n  port: 4001\n' > "$A/project/config.yaml"
run_runner "$REPO" --learn demo --diff
check "diff: a changed value prints old -> new" $([ "$RC" -eq 2 ] && has '~ llm.port: 4000 -> 4001' && echo 0 || echo 1)
STUB_NETNS_DIR="$REPO/work/adapt/other/project" run_runner "$REPO" --learn demo --diff
check "diff: refuses a gateway started for another name" $([ "$RC" -eq 1 ] && has "started for another name" && echo 0 || echo 1)
run_runner "$REPO" --learn nothere --diff
check "diff: no gateway for the name exits 1" $([ "$RC" -eq 1 ] && has "no learning gateway for nothere" && echo 0 || echo 1)

# restart
run_runner "$REPO" --learn demo --restart
check "restart: restarts agentgateway only, the netns stays" $([ "$RC" -eq 0 ] && grep -E 'compose .* restart' "$TMP/docker.log" | grep -qE 'restart agentgateway$' && ! log_has "restart netns" && ! grep -qE 'compose .* (down|stop) ' "$TMP/docker.log" && echo 0 || echo 1)
check "restart: waits again and prints LEARN READY" $(grep -q '^run .*container:agw-e2e-learn-netns-1' "$TMP/docker.log" && has "LEARN READY agw-e2e-learn" && echo 0 || echo 1)
STUB_SERVICES="agentgateway agentgateway-2 netns postgres" run_runner "$REPO" --learn demo --restart
check "restart: with postgres, both gateways" $(log_has "restart agentgateway agentgateway-2" && echo 0 || echo 1)
STUB_NETNS_RUNNING=false run_runner "$REPO" --learn demo --restart
check "restart: not running exits 1" $([ "$RC" -eq 1 ] && has "not running" && ! log_has " restart " && echo 0 || echo 1)

# stop
printf 'config:\n  adminAddr: 0.0.0.0:15000\nllm:\n  port: 4002\n' > "$A/project/config.yaml"
run_runner "$REPO" --learn demo --stop
check "stop: saves config.after.yaml first" $(grep -q 'port: 4002' "$A/config.after.yaml" && echo 0 || echo 1)
check "stop: down -v on agw-e2e-learn" $(grep -E 'compose .* down -v' "$TMP/docker.log" | grep -qF -- '-p agw-e2e-learn ' && echo 0 || echo 1)
check "stop: exit 0, project dir removed, configs kept" $([ "$RC" -eq 0 ] && [ ! -d "$A/project" ] && [ -f "$A/config.before.yaml" ] && has "LEARN STOPPED agw-e2e-learn" && echo 0 || echo 1)
unset STUB_NETNS_DIR
STUB_COMPOSE_LS='[{"Name":"agw-e2e-learn"},{"Name":"agw-e2e-old"}]' run_runner "$REPO" --learn demo --stop
check "stop: still listed prints LEFTOVER PROJECT and exits 1" $([ "$RC" -eq 1 ] && has "LEFTOVER PROJECT: agw-e2e-learn" && ! has "LEFTOVER PROJECT: agw-e2e-old" && echo 0 || echo 1)
check "stop: with no project dir, down by project name" $(log_has "compose -p agw-e2e-learn down -v --remove-orphans" && echo 0 || echo 1)
cat > "$TMP/stubs/docker-lsfail" <<'STUB'
#!/usr/bin/env bash
case " $* " in *" ls "*) exit 1 ;; esac
exit 0
STUB
chmod +x "$TMP/stubs/docker-lsfail"
OUT=$(cd "$REPO" && env PATH="$TMP/stubs:$PATH" E2E_DOCKER="$TMP/stubs/docker-lsfail" E2E_WORK_ROOT="$REPO/work" bash e2e/run-e2e.sh --learn demo --stop 2>&1); RC=$?
check "stop: a failed listing exits non-zero" $([ "$RC" -ne 0 ] && has "cannot list" && echo 0 || echo 1)

printf '\n%s passed, %s failed\n' "$T_PASS" "$T_FAIL"
[ "$T_FAIL" -eq 0 ]
