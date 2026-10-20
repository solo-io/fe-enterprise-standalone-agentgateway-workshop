#!/usr/bin/env bash
# Static checks for lab markdown:
#  - every lab has "## Before you start" with a relative link to the lab it builds on
#  - every lab has "## Clean up"
#  - every relative link and image resolves
#  - no em dashes in markdown files
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
err() { echo "$1: $2" >&2; fail=1; }

for f in labs/*/*.md; do
  [ -e "$f" ] || continue
  grep -q '^## Before you start' "$f" || err "$f" "missing '## Before you start'"
  awk '/^## Before you start/{f=1;next} /^## /{f=0} f' "$f" | grep -qE '\]\((\.\./)+[^)]+\.md' \
    || err "$f" "'## Before you start' has no relative link to a lab"
  grep -q '^## Clean up' "$f" || err "$f" "missing '## Clean up'"
done

for f in README.md style-guide.md 001-*.md labs/*/*.md; do
  [ -e "$f" ] || continue
  dir=$(dirname "$f")
  while IFS= read -r link; do
    target="${link%%#*}"
    [ -z "$target" ] && continue
    [ -e "$dir/$target" ] || err "$f" "broken link: $link"
  done < <(awk '/^```/{c=!c;next} !c' "$f" | sed -E 's/`[^`]*`//g' | grep -oE '\]\([^)]+\)' | sed -E 's/^\]\(//; s/\)$//' | grep -vE '^(https?:|mailto:|#)')
  grep -n '—' "$f" | sed "s|^|$f: em dash: |" >&2 && fail=1
done

[ $fail -eq 0 ] && echo "lint ok"
exit $fail
