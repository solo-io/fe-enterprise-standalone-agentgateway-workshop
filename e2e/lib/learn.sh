# shellcheck shell=bash
# The learning gateway for adapt's learning phase: a throwaway gateway that the Playwright MCP server
# (playwright-mcp.sh) drives, so the user's own gateway on host port 15000 is never touched.
# run-e2e.sh sources this file for --learn and calls learn_main; it needs ROOT, CUSTOM_ROOT, E2E_DOCKER, PW_IMAGE,
# need_env, fixture_file and list_e2e_projects from run-e2e.sh and keys.sh.
#
#   --learn <name> [--profiles <p1,p2>]  start: the base fixture and the helper profiles, as a spec run starts them,
#                                        no host ports; prints LEARN READY agw-e2e-learn and leaves it running
#   --learn <name> --diff                save the gateway's config to config.after.yaml and print what changed
#                                        since config.before.yaml; exit 0 when equal, 2 when different
#   --learn <name> --restart             restart the gateway service(s); the netns container (and the browser's
#                                        network) stays; prints LEARN READY agw-e2e-learn again
#   --learn <name> --stop                save config.after.yaml, then down -v; LEFTOVER PROJECT and exit 1 if
#                                        agw-e2e-learn is still listed
#
# The project is always agw-e2e-learn with compose.e2e-restart.yaml, so the pause container is agw-e2e-learn-netns-1,
# the container playwright-mcp.sh joins. Only one learning gateway runs at a time.
# Files: custom-labs/<name>/.work/learn/config.before.yaml, config.after.yaml, profiles, and project/ (the Compose
# project dir: a copy of setup/ with the gateway's live config.yaml; --stop removes it, since it holds a copy of
# setup/.env). They live in the custom lab's folder, so deleting custom-labs/<name>/ removes them too.

LEARN_PROJECT=agw-e2e-learn
LEARN_NETNS="$LEARN_PROJECT-netns-1"

# learn_compose <args...>: docker compose for the learning project, with its saved profiles.
learn_compose() {
  local profile_args=() p ps
  if [ -s "$LEARN_DIR/profiles" ]; then
    IFS=, read -ra ps < "$LEARN_DIR/profiles" || true  # the file has no newline, so read returns 1
    for p in ${ps[@]+"${ps[@]}"}; do [ -n "$p" ] && profile_args+=(--profile "$p"); done
  fi
  env UID="$(id -u)" GID="$(id -g)" "$E2E_DOCKER" compose -p "$LEARN_PROJECT" --project-directory "$LEARN_DIR/project" \
    -f "$LEARN_DIR/project/docker-compose.yml" -f "$ROOT/e2e/compose.e2e.yaml" -f "$ROOT/e2e/compose.e2e-restart.yaml" \
    ${profile_args[@]+"${profile_args[@]}"} "$@"
}

# The Compose project dir of the running learning gateway, empty when its netns container does not exist.
learn_owner_dir() {
  "$E2E_DOCKER" inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$LEARN_NETNS" 2>/dev/null || true
}

# learn_owner_name <project dir>: the learning name of a project dir, custom-labs/<name>/.work/learn/project.
learn_owner_name() { basename "$(dirname "$(dirname "$(dirname "$1")")")"; }

# learn_check_owner: refuses (exit 1) when agw-e2e-learn was started for another name.
learn_check_owner() {
  local owner
  owner=$(learn_owner_dir)
  [ -z "$owner" ] || [ "$owner" = "$LEARN_DIR/project" ] && return 0
  echo "$LEARN_PROJECT was started for another name ($owner), not $LEARN_NAME" >&2
  echo "use: e2e/run-e2e.sh --learn $(learn_owner_name "$owner") --diff|--restart|--stop" >&2
  exit 1
}

# learn_wait: waits up to 60 s for the gateway to answer inside the netns, as a spec run waits.
learn_wait() {
  "$E2E_DOCKER" run --rm --network "container:$LEARN_NETNS" "$PW_IMAGE" bash -c \
    'for i in $(seq 1 60); do curl -sf localhost:15000/api/runtime >/dev/null && exit 0; sleep 1; done; exit 1'
}

learn_logs() {
  echo "--- gateway log (last 40 lines)" >&2
  learn_compose logs --no-color --tail 40 agentgateway 2>&1 | cut -c1-300 >&2 || true
}

# learn_save: copies the gateway's current config to config.after.yaml. The project dir is a bind mount,
# so its config.yaml is the file the gateway writes.
learn_save() {
  [ -f "$LEARN_DIR/project/config.yaml" ] || return 1
  cp "$LEARN_DIR/project/config.yaml" "$LEARN_DIR/config.after.yaml"
  echo "saved $LEARN_DIR/config.after.yaml"
}

learn_start() {
  local profiles="$1" known p ps projects owner
  need_env
  # Profiles must be known Compose profiles, as lint.sh checks a spec's @profiles.
  known=$(grep -E '^[[:space:]]*profiles:' "$ROOT/setup/docker-compose.yml" 2>/dev/null | sed -E 's/.*\[//; s/\].*//' | tr ',' '\n' | tr -d ' "' | sort -u)
  profiles=$(printf '%s' "$profiles" | tr -d ' ')
  if [ -n "$profiles" ]; then
    IFS=',' read -ra ps <<<"$profiles"
    for p in "${ps[@]}"; do
      [ -n "$p" ] && echo "$known" | grep -qxF -- "$p" \
        || { echo "unknown compose profile: '$p' (known: $(echo "$known" | tr '\n' ' ' | sed 's/ $//'))" >&2; exit 64; }
    done
  fi
  projects=$(list_e2e_projects) || { echo "cannot list Compose projects; is Docker running?" >&2; exit 1; }
  if printf '%s\n' "$projects" | grep -qxF "$LEARN_PROJECT"; then
    owner=$(learn_owner_dir)
    echo "a learning gateway already exists (Compose project $LEARN_PROJECT). Stop it first:" >&2
    if [ -n "$owner" ]; then echo "  e2e/run-e2e.sh --learn $(learn_owner_name "$owner") --stop" >&2
    else echo "  e2e/run-e2e.sh --learn <name> --stop   (or: docker compose -p $LEARN_PROJECT down -v)" >&2; fi
    exit 1
  fi

  rm -rf "$LEARN_DIR"; mkdir -p "$LEARN_DIR/project"
  printf '%s' "$profiles" > "$LEARN_DIR/profiles"
  # Copy the reader's setup, then swap in the base fixture, as a spec run does.
  (cd "$ROOT/setup" && tar cf - --exclude 'data.db*' .) | (cd "$LEARN_DIR/project" && tar xf -)
  cp "$ROOT/$(fixture_file base)" "$LEARN_DIR/project/config.yaml"
  cp "$LEARN_DIR/project/config.yaml" "$LEARN_DIR/config.before.yaml"

  # Anything that fails from here takes the project down again.
  LEARN_UP=0
  trap '[ "$LEARN_UP" = 1 ] || { learn_compose --profile "*" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$LEARN_DIR/project"; }' EXIT
  echo "=== learn $LEARN_NAME (fixture: base, profiles: ${profiles:-none}, project: $LEARN_PROJECT)"
  learn_compose --progress quiet up -d --quiet-pull || { echo "compose up failed" >&2; exit 1; }
  learn_wait || { echo "the learning gateway did not answer on localhost:15000 within 60 s" >&2; learn_logs; exit 1; }
  LEARN_UP=1
  trap - EXIT
  echo "start config: $LEARN_DIR/config.before.yaml"
  echo "browser network: container $LEARN_NETNS (playwright-mcp.sh joins it)"
  echo "LEARN READY $LEARN_PROJECT"
}

learn_diff() {
  [ -f "$LEARN_DIR/project/config.yaml" ] && [ -f "$LEARN_DIR/config.before.yaml" ] \
    || { echo "no learning gateway for $LEARN_NAME (start one with e2e/run-e2e.sh --learn $LEARN_NAME)" >&2; exit 1; }
  learn_check_owner
  learn_save
  local rc=0
  # The host runs node when it has it; otherwise the Playwright image does, as for --report-only.
  if command -v node >/dev/null 2>&1; then
    node "$ROOT/e2e/lib/learn-diff.mjs" "$LEARN_DIR/config.before.yaml" "$LEARN_DIR/config.after.yaml" || rc=$?
  else
    "$E2E_DOCKER" run --rm -v "$ROOT:/repo" -v "$LEARN_DIR:/adapt" -w /repo/e2e "$PW_IMAGE" \
      node lib/learn-diff.mjs /adapt/config.before.yaml /adapt/config.after.yaml || rc=$?
  fi
  case $rc in 0|2) return $rc ;; *) return 1 ;; esac
}

learn_restart() {
  [ -d "$LEARN_DIR/project" ] || { echo "no learning gateway for $LEARN_NAME (start one with e2e/run-e2e.sh --learn $LEARN_NAME)" >&2; exit 1; }
  [ "$("$E2E_DOCKER" inspect -f '{{.State.Running}}' "$LEARN_NETNS" 2>/dev/null)" = true ] \
    || { echo "the learning gateway is not running (container $LEARN_NETNS)" >&2; exit 1; }
  learn_check_owner
  local services=() s
  # The gateway services that run: agentgateway, and agentgateway-2 with the postgres profile.
  while IFS= read -r s; do
    case "$s" in agentgateway|agentgateway-2) services+=("$s") ;; esac
  done < <(learn_compose ps --services --status running 2>/dev/null)
  [ ${#services[@]} -gt 0 ] || services=(agentgateway)
  echo "=== learn $LEARN_NAME: restarting ${services[*]} (the netns container stays)"
  learn_compose restart "${services[@]}" || { echo "compose restart failed" >&2; exit 1; }
  learn_wait || { echo "the learning gateway did not answer on localhost:15000 within 60 s after the restart" >&2; learn_logs; exit 1; }
  echo "LEARN READY $LEARN_PROJECT"
}

learn_stop() {
  local name n=0 projects
  learn_check_owner
  learn_save || echo "no config to save: $LEARN_DIR/project/config.yaml does not exist"
  if [ -d "$LEARN_DIR/project" ]; then
    learn_compose --profile "*" down -v --remove-orphans >/dev/null 2>&1 || true
  else
    # No project dir (started from another work root, or already removed): down by project name only.
    "$E2E_DOCKER" compose -p "$LEARN_PROJECT" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  # The project dir holds a copy of setup/.env; the saved configs stay for adapt.
  rm -rf "$LEARN_DIR/project"
  projects=$(list_e2e_projects) || { echo "cannot list Compose projects, so cannot confirm $LEARN_PROJECT is gone" >&2; return 1; }
  while IFS= read -r name; do
    [ "$name" = "$LEARN_PROJECT" ] || continue
    echo "LEFTOVER PROJECT: $name"
    n=$((n + 1))
  done <<<"$projects"
  [ $n -eq 0 ] || return 1
  echo "LEARN STOPPED $LEARN_PROJECT"
}

# learn_main <name> <start|diff|restart|stop> <profiles>
learn_main() {
  LEARN_NAME="$1"
  LEARN_DIR="$CUSTOM_ROOT/$1/.work/learn"
  case "$2" in
    start) learn_start "$3" ;;
    diff) learn_diff ;;
    restart) learn_restart ;;
    stop) learn_stop ;;
  esac
}
