# Key checks shared by run-e2e.sh and detect-env.sh. Source this file; it does not exit on a missing setup/.env.
# ROOT is the repo root (set by the caller, else derived from this file's location).
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

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

# Checks each key once per run against its provider. Specs skip the parts that need a key that is
# missing or rejected; an OpenAI key that does not work stops the run, since almost every lab needs it.
# Also sets KEY_STATUS_<NAME> to ok|missing|rejected for each key (detect-env.sh reads them).
# With KEYS_NO_EXIT=1 a bad OpenAI key does not exit: the other keys are still checked and the
# function returns 1 at the end, so a caller can report every key.
check_keys() {
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
  if [ -z "$k" ]; then echo "ANTHROPIC_API_KEY: not set, Anthropic tests skip"
  else
    code=$(status_of https://api.anthropic.com/v1/models -H "x-api-key: $k" -H 'anthropic-version: 2023-06-01')
    if [ "$code" = 200 ]; then HAS_ANTHROPIC=1; KEY_STATUS_ANTHROPIC_API_KEY=ok
    else KEY_STATUS_ANTHROPIC_API_KEY=rejected; echo "ANTHROPIC_API_KEY: rejected (HTTP $code), Anthropic tests skip"; fi
  fi

  # A valid key gets past authentication and fails on the empty body.
  HAS_TYPESAFE=0
  KEY_STATUS_TYPESAFE_AI_API_KEY=missing
  k=$(env_val TYPESAFE_AI_API_KEY)
  if [ -z "$k" ]; then echo "TYPESAFE_AI_API_KEY: not set, Jev tests skip"
  else
    code=$(status_of -X POST https://api.typesafe.ai/v1/systemone -H "Authorization: Bearer $k" -H 'Content-Type: application/json' -d '{}')
    case "$code" in
      000|401|403) KEY_STATUS_TYPESAFE_AI_API_KEY=rejected; echo "TYPESAFE_AI_API_KEY: rejected (HTTP $code), Jev tests skip" ;;
      *) HAS_TYPESAFE=1; KEY_STATUS_TYPESAFE_AI_API_KEY=ok ;;
    esac
  fi

  # AWS credentials are often short-lived SSO exports; check them with the AWS CLI when it is installed.
  HAS_AWS=0
  KEY_STATUS_AWS_ACCESS_KEY_ID=missing
  if [ -z "$(env_val AWS_ACCESS_KEY_ID)" ]; then echo "AWS_ACCESS_KEY_ID: not set, Bedrock tests skip"
  elif ! command -v aws >/dev/null; then HAS_AWS=1; KEY_STATUS_AWS_ACCESS_KEY_ID=ok
  elif AWS_ACCESS_KEY_ID=$(env_val AWS_ACCESS_KEY_ID) AWS_SECRET_ACCESS_KEY=$(env_val AWS_SECRET_ACCESS_KEY) \
    AWS_SESSION_TOKEN=$(env_val AWS_SESSION_TOKEN) AWS_PROFILE='' AWS_REGION=us-east-1 \
    aws sts get-caller-identity >/dev/null 2>&1; then HAS_AWS=1; KEY_STATUS_AWS_ACCESS_KEY_ID=ok
  else KEY_STATUS_AWS_ACCESS_KEY_ID=rejected; echo "AWS credentials: rejected or expired, Bedrock tests skip"
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
  else echo "CLAUDE_CODE_OAUTH_TOKEN: not set, Claude subscription tests skip"; fi
  return "$openai_rc"
}
