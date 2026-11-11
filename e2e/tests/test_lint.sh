#!/usr/bin/env bash
# Tests for lint.sh --file / --spec / --custom against the fixtures in fixtures/custom-labs.
E2E="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIX="$E2E/tests/fixtures/custom-labs"
T_PASS=0; T_FAIL=0
check() { # check <name> <condition-exit-code>
  if [ "$2" -eq 0 ]; then T_PASS=$((T_PASS+1)); printf 'ok   %s\n' "$1"
  else T_FAIL=$((T_FAIL+1)); printf 'FAIL %s\n' "$1"; fi
}

lint_custom() { # lint_custom <fixture name>: sets OUT and RC
  RC=0
  OUT=$("$E2E/lint.sh" --file "$FIX/$1/$1.md" --spec "$FIX/$1/$1.spec.ts" --custom 2>&1) || RC=$?
}
expect_fail() { # expect_fail <fixture> <text the message must contain>
  lint_custom "$1"
  check "$1: exits 1" $([ "$RC" -eq 1 ] && echo 0 || echo 1)
  check "$1: message has '$2'" $(printf '%s\n' "$OUT" | grep -qF -- "$2" && echo 0 || echo 1)
}

lint_custom demo
check "demo clean: exits 0" $([ "$RC" -eq 0 ] && echo 0 || echo 1)
check "demo clean: prints lint ok" $(printf '%s\n' "$OUT" | grep -qxF "lint ok" && echo 0 || echo 1)
check "demo clean: skips the port check" $(printf '%s\n' "$OUT" | grep -qi port && echo 1 || echo 0)

expect_fail missing-shot "03-c.png"
expect_fail extra-png "09-x.png"
expect_fail no-req "@req"
expect_fail uncovered-req "R2"
expect_fail wrong-first-line "first line"
expect_fail wrong-import "../lib/"
expect_fail bad-profile "nosuch"

# @profiles in the spec: known names, and the same set the lab starts (indented fences count)
PTMP="$(mktemp -d)"
profile_case() { # profile_case <@profiles value or -> <lab profile or ->: lints a demo copy, sets OUT and RC
  rm -rf "$PTMP/demo"; cp -R "$FIX/demo" "$PTMP/demo"
  [ "$1" = - ] || sed -i.bak "1a\\
// @profiles $1
" "$PTMP/demo/demo.spec.ts"
  [ "$2" = - ] || printf '\n1. Start the helper:\n\n   ```bash\n   docker compose --profile %s up -d\n   ```\n' "$2" >> "$PTMP/demo/demo.md"
  rm -f "$PTMP/demo/"*.bak
  RC=0; OUT=$("$E2E/lint.sh" --file "$PTMP/demo/demo.md" --spec "$PTMP/demo/demo.spec.ts" --custom 2>&1) || RC=$?
}
profile_case mock-llmm mock-llm
check "@profiles typo: flagged" $([ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -qF "unknown compose profile in @profiles: mock-llmm" && echo 0 || echo 1)
profile_case - mock-llm
check "lab profile in an indented fence missing from @profiles: flagged" $([ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -qF "the lab starts profile mock-llm but @profiles does not list it" && echo 0 || echo 1)
profile_case mock-llm -
check "@profiles the lab never starts: flagged" $([ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -qF "@profiles lists mock-llm but the lab never starts it" && echo 0 || echo 1)
profile_case mock-llm mock-llm
check "matching @profiles and lab profile: lint ok" $([ "$RC" -eq 0 ] && echo 0 || echo "1 $OUT")
rm -rf "$PTMP"

# --file alone finds <dir>/<name>.spec.ts and checks screenshot agreement only
RC=0; OUT=$("$E2E/lint.sh" --file "$FIX/extra-png/extra-png.md" 2>&1) || RC=$?
check "--file alone: extra png flagged" $([ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -qF "unreferenced image: 09-x.png" && echo 0 || echo 1)
RC=0; OUT=$("$E2E/lint.sh" --file "$FIX/no-req/no-req.md" 2>&1) || RC=$?
check "--file alone: no custom spec checks" $([ "$RC" -eq 0 ] && echo 0 || echo 1)

# a non-literal shot name and a shot/markdown mismatch
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/lit"; cp -R "$FIX/demo/." "$T/lit/"; mv "$T/lit/demo.md" "$T/lit/lit.md"; mv "$T/lit/demo.spec.ts" "$T/lit/lit.spec.ts"
sed -i.bak "1s|.*|// custom-labs/lit/lit.md|; s|shot(page, '01-a')|shot(page, \`\${'01'}-a\`)|" "$T/lit/lit.spec.ts"
RC=0; OUT=$("$E2E/lint.sh" --file "$T/lit/lit.md" --spec "$T/lit/lit.spec.ts" --custom 2>&1) || RC=$?
check "non-literal shot name flagged" $([ "$RC" -eq 1 ] && printf '%s\n' "$OUT" | grep -qF "shot name must be a string literal" && echo 0 || echo 1)
sed -i.bak "s|shot(page, \`.*\`)|shot(page, '07-q')|" "$T/lit/lit.spec.ts"
RC=0; OUT=$("$E2E/lint.sh" --file "$T/lit/lit.md" --spec "$T/lit/lit.spec.ts" --custom 2>&1) || RC=$?
check "shot without image reference flagged" $(printf '%s\n' "$OUT" | grep -qF "shot without image reference: 07-q" && echo 0 || echo 1)
check "image without shot flagged" $(printf '%s\n' "$OUT" | grep -qF "image without shot: 01-a" && echo 0 || echo 1)

# a spec that declares an undeclared requirement
sed -i.bak "s|\[R2\]|[R3]|" "$T/lit/lit.spec.ts"
RC=0; OUT=$("$E2E/lint.sh" --file "$T/lit/lit.md" --spec "$T/lit/lit.spec.ts" --custom 2>&1) || RC=$?
check "undeclared requirement flagged" $(printf '%s\n' "$OUT" | grep -qF "test references undeclared R3" && echo 0 || echo 1)

# shipped labs: no arguments. Record the result; screenshot-agreement lines are allowed.
RC=0; OUT=$("$E2E/lint.sh" 2>&1) || RC=$?
other=$(printf '%s\n' "$OUT" | grep -vE '^lint ok$|: (missing image|unreferenced image): ' || true)
check "shipped: only screenshot-agreement lines or lint ok" $([ -z "$other" ] && echo 0 || echo 1)
[ -z "$other" ] || printf '%s\n' "$other"

printf '\n%s passed, %s failed\n' "$T_PASS" "$T_FAIL"
[ "$T_FAIL" -eq 0 ]
