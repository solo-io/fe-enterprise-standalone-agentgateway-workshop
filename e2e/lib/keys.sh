# Key checks and the agw-e2e project listing, shared by run-e2e.sh and detect-env.sh. Source this file; it does not
# exit on a missing setup/.env. ROOT is the repo root (set by the caller, else derived from this file's location).
# WORK_ROOT is the harness work dir (default e2e/.work), where check_keys keeps keys.cache.
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# The agw-e2e-* Compose projects Docker lists, running or not, one per line. Returns 1 when the listing fails.
# E2E_DOCKER replaces docker.
list_e2e_projects() {
  local raw
  raw=$("${E2E_DOCKER:-docker}" compose ls -a --format json 2>/dev/null) || return 1
  printf '%s\n' "$raw" | grep -oE '"Name" *: *"agw-e2e-[^"]*"' | sed -E 's/.*"(agw-e2e-[^"]*)"/\1/' || true
}

# A key's value: exported in the shell first, then setup/.env, as in Docker Compose.
env_val() {
  local v="${!1:-}"
  [ -n "$v" ] || v=$(grep -E "^$1=" "$ROOT/setup/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//")
  echo "$v"
}

# Every key check_keys reports, in order.
KEY_NAMES="OPENAI_API_KEY ANTHROPIC_API_KEY TYPESAFE_AI_API_KEY AWS_ACCESS_KEY_ID BEDROCK_API_KEY CLAUDE_CODE_OAUTH_TOKEN"

# HTTP status of a request, 000 when the host does not answer. E2E_CURL replaces curl in tests.
status_of() { "${E2E_CURL:-curl}" -s -o /dev/null -m 15 -w '%{http_code}' "$@" || true; }

# Checks each key against its provider. Specs skip the parts that need a key that is
# missing or rejected; an OpenAI key that does not work stops the run, since almost every lab needs it.
# Also sets KEY_STATUS_<NAME> to ok|missing|rejected for each key (detect-env.sh reads them).
# With KEYS_NO_EXIT=1 a bad OpenAI key does not exit: the other keys are still checked and the
# function returns 1 at the end, so a caller can report every key.
#
# A result with a working OpenAI key is kept in $WORK_ROOT/keys.cache and reused for E2E_KEYS_TTL seconds
# (default 600, 0 turns reuse off), so the one-lab-at-a-time runs of a session do not call every provider
# again. The cache holds statuses, the printed lines and a hash of the key values, never a key. A change to
# any key value or to setup/.env makes it stale. KEYS_LIVE=1 always checks and refreshes the cache.
check_keys() {
  local cache fp
  cache="${WORK_ROOT:-$ROOT/e2e/.work}/keys.cache"
  fp=$(keys_fingerprint)
  if [ -z "${KEYS_LIVE:-}" ] && [ -n "$fp" ] && keys_cache_load "$cache" "$fp"; then
    CLAUDE_CODE_OAUTH_TOKEN=$(env_val CLAUDE_CODE_OAUTH_TOKEN)
    return 0
  fi
  KEYS_MSGS=""
  check_keys_live || return $?
  [ -n "$fp" ] && keys_cache_save "$cache" "$fp"
  return 0
}

# Every value check_keys reads, hashed; empty when no hash tool is installed (then nothing is cached).
keys_fingerprint() {
  local n hasher
  if command -v shasum >/dev/null 2>&1; then hasher=(shasum -a 256)
  elif command -v sha256sum >/dev/null 2>&1; then hasher=(sha256sum)
  else return 0; fi
  for n in $KEY_NAMES AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do printf '%s=%s\n' "$n" "$(env_val "$n")"; done \
    | "${hasher[@]}" | cut -c1-64
}

KEYS_CACHED_VARS="HAS_ANTHROPIC HAS_TYPESAFE HAS_AWS HAS_BEDROCK_KEY HAS_CLAUDE_OAUTH"

# keys_cache_load <file> <fingerprint>: sets the statuses and prints the saved lines; returns 1 when the cache
# is missing, stale, for other key values, or malformed (and then sets and prints nothing).
keys_cache_load() {
  local file="$1" fp="$2" ttl="${E2E_KEYS_TTL:-600}" at now line name val
  case "$ttl" in ''|*[!0-9]*) ttl=600 ;; esac
  [ "$ttl" -gt 0 ] && [ -f "$file" ] || return 1
  [ -f "$ROOT/setup/.env" ] && [ "$ROOT/setup/.env" -nt "$file" ] && return 1
  [ "$(sed -n 's/^fp=//p' "$file")" = "$fp" ] || return 1
  at=$(sed -n 's/^at=//p' "$file"); now=$(date +%s)
  case "$at" in ''|*[!0-9]*) return 1 ;; esac
  [ $((now - at)) -lt "$ttl" ] || return 1
  for name in $KEYS_CACHED_VARS; do grep -qE "^$name=[01]\$" "$file" || return 1; done
  for name in $KEY_NAMES; do grep -qE "^KEY_STATUS_$name=(ok|missing|rejected)\$" "$file" || return 1; done
  while IFS= read -r line; do
    case "$line" in
      KEY_STATUS_*=*|HAS_*=*) name="${line%%=*}"; val="${line#*=}"; printf -v "$name" '%s' "$val" ;;
      msg=*) echo "${line#msg=}" ;;
    esac
  done < "$file"
  echo "key checks: reused from $((now - at))s ago (E2E_KEYS_TTL=0 checks again)"
}

keys_cache_save() {
  local file="$1" fp="$2" name tmp
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 0
  tmp="$file.$$"
  {
    echo "fp=$fp"
    echo "at=$(date +%s)"
    for name in $KEYS_CACHED_VARS; do echo "$name=${!name}"; done
    for name in $KEY_NAMES; do eval "echo \"KEY_STATUS_$name=\${KEY_STATUS_$name}\""; done
    printf '%s' "$KEYS_MSGS" | sed 's/^/msg=/'
  } > "$tmp" 2>/dev/null && mv "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
}

# say <line>: print a key-check line and keep it for the cache.
say() { echo "$1"; KEYS_MSGS="$KEYS_MSGS$1"$'\n'; }

check_keys_live() {
  local k code openai_rc=0
  KEY_STATUS_OPENAI_API_KEY=ok
  k=$(env_val OPENAI_API_KEY)
  if [ -z "$k" ]; then code=000; else code=$(status_of https://api.openai.com/v1/models -H "Authorization: Bearer $k"); fi
  if [ "$code" != 200 ]; then
    if [ -z "$k" ]; then KEY_STATUS_OPENAI_API_KEY=missing; else KEY_STATUS_OPENAI_API_KEY=rejected; fi
    echo "OPENAI_API_KEY does not work (HTTP $code); fix it in setup/.env" >&2
    if [ -n "${KEYS_NO_EXIT:-}" ]; then openai_rc=1; else exit 1; fi
  fi

  HAS_ANTHROPIC=0
  KEY_STATUS_ANTHROPIC_API_KEY=missing
  k=$(env_val ANTHROPIC_API_KEY)
  if [ -z "$k" ]; then say "ANTHROPIC_API_KEY: not set, Anthropic tests skip"
  else
    code=$(status_of https://api.anthropic.com/v1/models -H "x-api-key: $k" -H 'anthropic-version: 2023-06-01')
    if [ "$code" = 200 ]; then HAS_ANTHROPIC=1; KEY_STATUS_ANTHROPIC_API_KEY=ok
    else KEY_STATUS_ANTHROPIC_API_KEY=rejected; say "ANTHROPIC_API_KEY: rejected (HTTP $code), Anthropic tests skip"; fi
  fi

  # A valid key gets past authentication and fails on the empty body.
  HAS_TYPESAFE=0
  KEY_STATUS_TYPESAFE_AI_API_KEY=missing
  k=$(env_val TYPESAFE_AI_API_KEY)
  if [ -z "$k" ]; then say "TYPESAFE_AI_API_KEY: not set, Jev tests skip"
  else
    code=$(status_of -X POST https://api.typesafe.ai/v1/systemone -H "Authorization: Bearer $k" -H 'Content-Type: application/json' -d '{}')
    case "$code" in
      000|401|403) KEY_STATUS_TYPESAFE_AI_API_KEY=rejected; say "TYPESAFE_AI_API_KEY: rejected (HTTP $code), Jev tests skip" ;;
      *) HAS_TYPESAFE=1; KEY_STATUS_TYPESAFE_AI_API_KEY=ok ;;
    esac
  fi

  # AWS credentials are often short-lived SSO exports; check them with the AWS CLI when it is installed.
  HAS_AWS=0
  KEY_STATUS_AWS_ACCESS_KEY_ID=missing
  if [ -z "$(env_val AWS_ACCESS_KEY_ID)" ]; then say "AWS_ACCESS_KEY_ID: not set, Bedrock tests skip"
  elif ! command -v aws >/dev/null; then HAS_AWS=1; KEY_STATUS_AWS_ACCESS_KEY_ID=ok
  elif AWS_ACCESS_KEY_ID=$(env_val AWS_ACCESS_KEY_ID) AWS_SECRET_ACCESS_KEY=$(env_val AWS_SECRET_ACCESS_KEY) \
    AWS_SESSION_TOKEN=$(env_val AWS_SESSION_TOKEN) AWS_PROFILE='' AWS_REGION=us-east-1 \
    aws sts get-caller-identity >/dev/null 2>&1; then HAS_AWS=1; KEY_STATUS_AWS_ACCESS_KEY_ID=ok
  else KEY_STATUS_AWS_ACCESS_KEY_ID=rejected; say "AWS credentials: rejected or expired, Bedrock tests skip"
  fi

  # No cheap check for a Bedrock API key without a region and model; only check it is set.
  HAS_BEDROCK_KEY=0
  KEY_STATUS_BEDROCK_API_KEY=missing
  if [ -n "$(env_val BEDROCK_API_KEY)" ]; then HAS_BEDROCK_KEY=1; KEY_STATUS_BEDROCK_API_KEY=ok; fi

  # A Claude subscription token (claude setup-token). Anthropic accepts it only from Claude Code, so only check it is set.
  CLAUDE_CODE_OAUTH_TOKEN=$(env_val CLAUDE_CODE_OAUTH_TOKEN)
  HAS_CLAUDE_OAUTH=0
  KEY_STATUS_CLAUDE_CODE_OAUTH_TOKEN=missing
  if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then HAS_CLAUDE_OAUTH=1; KEY_STATUS_CLAUDE_CODE_OAUTH_TOKEN=ok
  else say "CLAUDE_CODE_OAUTH_TOKEN: not set, Claude subscription tests skip"; fi
  return "$openai_rc"
}
