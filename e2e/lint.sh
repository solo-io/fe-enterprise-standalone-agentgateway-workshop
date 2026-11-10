#!/usr/bin/env bash
# Static checks for lab markdown:
#  - every lab has "## Before you start" with a relative link to the lab it builds on
#  - every lab has "## Clean up"
#  - every relative link and image resolves
#  - no em dashes in markdown files
#  - host ports in setup/docker-compose.yml match the labs (check-ports.sh)
#  - screenshot agreement: the PNGs in a lab's image folder are the PNGs its markdown references
#    (shipped labs that have a spec in e2e/labs; the spec names its lab on line 1)
#
#   e2e/lint.sh                                         every shipped lab
#   e2e/lint.sh --file <lab.md>                         skeleton checks and screenshot agreement for one lab
#   e2e/lint.sh --file <lab.md> --spec <spec.ts> --custom
#                                                       also the custom-lab spec checks: line 1, @req lines
#                                                       covered by [R<n>] test titles, literal shot names that
#                                                       match the markdown, ../lib/ imports, compose profiles
set -uo pipefail
START_DIR="$PWD"
cd "$(dirname "$0")/.."

FILE=""; SPEC=""; CUSTOM=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file) [ $# -ge 2 ] || { echo "--file needs a path" >&2; exit 64; }; FILE="$2"; shift ;;
    --spec) [ $# -ge 2 ] || { echo "--spec needs a path" >&2; exit 64; }; SPEC="$2"; shift ;;
    --custom) CUSTOM=1 ;;
    *) echo "usage: $0 [--file <lab.md> [--spec <spec.ts>] [--custom]]" >&2; exit 64 ;;
  esac
  shift
done
[ -z "$FILE" ] && { [ -n "$SPEC" ] || [ $CUSTOM -eq 1 ]; } && { echo "--spec and --custom need --file" >&2; exit 64; }
[ $CUSTOM -eq 1 ] && [ -z "$SPEC" ] && { echo "--custom needs --spec" >&2; exit 64; }
# A relative path is taken from where the command ran, else from the repo root.
absolute() { case "$1" in /*) echo "$1" ;; *) [ -e "$START_DIR/$1" ] && echo "$START_DIR/$1" || echo "$PWD/$1" ;; esac; }
ROOT_DIR="$PWD"

fail=0
err() { echo "$1: $2" >&2; fail=1; }

skeleton_check() { # skeleton_check <lab.md>
  local f="$1"
  grep -q '^## Before you start' "$f" || err "$f" "missing '## Before you start'"
  awk '/^## Before you start/{f=1;next} /^## /{f=0} f' "$f" | grep -qE '\]\((\.\./)+[^)]+\.md' \
    || err "$f" "'## Before you start' has no relative link to a lab"
  grep -q '^## Clean up' "$f" || err "$f" "missing '## Clean up'"
}

link_check() { # link_check <md file>: links and images resolve, no em dashes
  local f="$1" dir link target
  dir=$(dirname "$f")
  while IFS= read -r link; do
    target="${link%%#*}"
    [ -z "$target" ] && continue
    [ -e "$dir/$target" ] || err "$f" "broken link: $link"
  done < <(awk '/^```/{c=!c;next} !c' "$f" | sed -E 's/`[^`]*`//g' | grep -oE '\]\([^)]+\)' | sed -E 's/^\]\(//; s/\)$//' | grep -vE '^(https?:|mailto:|#)')
  grep -n '—' "$f" | sed "s|^|$f: em dash: |" >&2 && fail=1
}

# normpath <path>: collapses . and .. without touching the disk.
normpath() {
  local out="" part IFS=/
  for part in $1; do
    case "$part" in ""|.) ;; ..) out="${out%/*}" ;; *) out="$out/$part" ;; esac
  done
  echo "${out:-/}"
}

# lab_images_dir <lab.md> <custom 0|1>: where the lab's PNGs live; empty when unknown.
lab_images_dir() {
  local lab="$1" custom="$2" rel
  if [ "$custom" = 1 ]; then echo "$(dirname "$lab")/images"; return; fi
  rel="${lab#"$ROOT_DIR"/}"
  case "$rel" in
    001-*.md) echo "$ROOT_DIR/images/setup/001" ;;
    labs/*/*.md) rel="${rel#labs/}"; echo "$ROOT_DIR/images/${rel%.md}" ;;
    *) echo "$(dirname "$lab")/images" ;;
  esac
}

# screenshot_check <lab.md> <image dir>: PNG basenames in the folder against PNG references in the markdown.
screenshot_check() {
  local lab="$1" idir="$2" a b ref target name shown
  shown="${lab#"$ROOT_DIR"/}"
  a=$(ls "$idir"/*.png 2>/dev/null | sed 's|.*/||' | sort -u)
  b=""
  while IFS= read -r ref; do
    target=$(normpath "$(dirname "$lab")/${ref%%#*}")
    [ "$(dirname "$target")" = "$(normpath "$idir")" ] && b="$b$(basename "$target")"$'\n'
  done < <(awk '/^```/{c=!c;next} !c' "$lab" | grep -oE '\]\([^)]+\.png\)' | sed -E 's/^\]\(//; s/\)$//' | grep -vE '^https?:')
  b=$(printf '%s' "$b" | sed '/^$/d' | sort -u)
  while IFS= read -r name; do [ -n "$name" ] && err "$shown" "missing image: $name"; done < <(comm -13 <(echo "$a") <(echo "$b"))
  while IFS= read -r name; do [ -n "$name" ] && err "$shown" "unreferenced image: $name"; done < <(comm -23 <(echo "$a") <(echo "$b"))
  MD_IMAGES="$b"
}

# The custom-spec checks. <md images> is the PNG basenames the markdown references, one per line.
custom_checks() { # custom_checks <lab.md> <spec.ts> <expected first line> <md images>
  local lab="$1" spec="$2" first="$3" md_images="$4" line n p name
  [ -f "$spec" ] || { err "$spec" "spec not found"; return; }
  [ "$(head -n1 "$spec")" = "// $first" ] || err "$spec" "first line must be '// $first'"

  local declared referenced
  declared=$(grep -oE '^// @req R[0-9]+' "$spec" | sed -E 's|^// @req ||' | sort -u)
  referenced=$(grep -E '^[[:space:]]*test(\.[a-z]+)?\(' "$spec" | grep -oE '\[R[0-9]+\]' | tr -d '[]' | sort -u)
  [ -n "$declared" ] || err "$spec" "no @req lines"
  for n in $declared; do
    echo "$referenced" | grep -qxF "$n" || err "$spec" "requirement $n has no test"
  done
  for n in $referenced; do
    echo "$declared" | grep -qxF "$n" || err "$spec" "test references undeclared $n"
  done

  while IFS= read -r line; do
    [ -n "$line" ] && err "$spec" "shot name must be a string literal: $(echo "$line" | sed -E 's/^[[:space:]]+//')"
  done < <(grep -E '(^|[^A-Za-z0-9_.])shot\(' "$spec" | grep -vE "shot\([^,]+,[[:space:]]*['\"][^'\"\`]+['\"]")

  local shots
  shots=$(grep -oE "shot\([^,]+,[[:space:]]*['\"][^'\"\`]+['\"]" "$spec" | sed -E "s/^shot\([^,]+,[[:space:]]*['\"]//; s/['\"]\$//" | sed 's/$/.png/' | sort -u)
  while IFS= read -r name; do [ -n "$name" ] && err "$spec" "shot without image reference: $name"; done < <(comm -23 <(echo "$shots") <(echo "$md_images"))
  while IFS= read -r name; do [ -n "$name" ] && err "$spec" "image without shot: $name"; done < <(comm -13 <(echo "$shots") <(echo "$md_images"))

  while IFS= read -r line; do
    grep -qE "^[[:space:]]*import .* from " <<<"$line" || continue
    p=$(echo "$line" | sed -E "s/.* from ['\"]([^'\"]+)['\"].*/\1/")
    case "$p" in .*) case "$p" in ../lib/*) ;; *) err "$spec" "import must start with ../lib/: $p" ;; esac ;; esac
  done < "$spec"

  local profiles known
  known=$(grep -E '^[[:space:]]*profiles:' setup/docker-compose.yml 2>/dev/null | sed -E 's/.*\[//; s/\].*//' | tr ',' '\n' | tr -d ' "' | sort -u)
  for p in $(awk '/^```/{c=!c;next} c' "$lab" | grep -oE -- '--profile[ =]+[A-Za-z0-9_-]+' | sed -E 's/--profile[ =]+//' | sort -u); do
    echo "$known" | grep -qxF "$p" || err "$lab" "unknown compose profile: $p"
  done
}

# spec_lab <spec.ts>: the lab path named on line 1 of a shipped spec, relative to the repo root.
spec_lab() { head -n1 "$1" | sed -nE 's|^// (labs/[a-z0-9-]+/[a-z0-9-]+\.md\|001-[A-Za-z0-9-]+\.md).*|\1|p'; }

if [ -n "$FILE" ]; then
  lab=$(absolute "$FILE")
  [ -f "$lab" ] || { echo "$FILE: not found" >&2; exit 1; }
  skeleton_check "$lab"
  link_check "$lab"
  if [ $CUSTOM -eq 1 ]; then
    spec=$(absolute "$SPEC")
    name=$(basename "$lab" .md)
    screenshot_check "$lab" "$(lab_images_dir "$lab" 1)"
    custom_checks "$lab" "$spec" "custom-labs/$name/$name.md" "$MD_IMAGES"
  else
    found=""
    if [ -f "$(dirname "$lab")/$(basename "$lab" .md).spec.ts" ]; then found=1
    else
      rel="${lab#"$ROOT_DIR"/}"
      for s in $(find e2e/labs -name '*.spec.ts'); do [ "$(spec_lab "$s")" = "$rel" ] && { found=1; break; }; done
    fi
    [ -n "$found" ] && screenshot_check "$lab" "$(lab_images_dir "$lab" 0)"
  fi
  [ $fail -eq 0 ] && echo "lint ok"
  exit $fail
fi

for f in labs/*/*.md; do
  [ -e "$f" ] || continue
  skeleton_check "$f"
done

for f in README.md style-guide.md 001-*.md labs/*/*.md; do
  [ -e "$f" ] || continue
  link_check "$f"
done

# Screenshot agreement for each shipped lab that has a spec; a lab with several specs is checked once.
checked=$'\n'
for s in $(find e2e/labs -name '*.spec.ts' | sort); do
  rel=$(spec_lab "$s")
  [ -n "$rel" ] && [ -f "$rel" ] || continue
  case "$checked" in *$'\n'"$rel"$'\n'*) continue ;; esac
  checked="$checked$rel"$'\n'
  screenshot_check "$ROOT_DIR/$rel" "$(lab_images_dir "$ROOT_DIR/$rel" 0)"
done

e2e/check-ports.sh || fail=1

[ $fail -eq 0 ] && echo "lint ok"
exit $fail
