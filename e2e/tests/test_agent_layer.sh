#!/usr/bin/env bash
# Tests for the agent layer: AGENTS.md, CLAUDE.md, .mcp.json, the slash commands, the skills and the README section.
# Static checks only; nothing here starts Docker or calls a network endpoint.
E2E="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$E2E/.." && pwd)"
cd "$REPO" || exit 1
T_PASS=0; T_FAIL=0
check() { # check <name> <condition-exit-code>
  if [ "$2" -eq 0 ]; then T_PASS=$((T_PASS+1)); printf 'ok   %s\n' "$1"
  else T_FAIL=$((T_FAIL+1)); printf 'FAIL %s\n' "$1"; fi
}

SKILLS="evaluate adapt-lab contribute-lab explain-lab diagnose-failure ask-the-docs"
COMMANDS="evaluate adapt-lab contribute-lab"

# AGENTS.md
[ -f AGENTS.md ]; check "AGENTS.md exists" $?
grep -qx '## Hard rules' AGENTS.md 2>/dev/null; check "AGENTS.md has ## Hard rules" $?
n=0
for i in 1 2 3 4; do
  awk '/^## Hard rules$/{on=1; next} /^## /{on=0} on' AGENTS.md 2>/dev/null | grep -qE "^$i\. \*\*[^*]+\*\*" && n=$((n+1))
done
[ "$n" -eq 4 ]; check "AGENTS.md hard rules section has rules 1 to 4 ($n found)" $?
for title in 'Never leave anything behind.' 'Nothing about the user'"'"'s gateway leaves the machine.' 'Least privilege' 'Stop on failure, do not improvise.'; do
  grep -qF "**$title" AGENTS.md 2>/dev/null; check "AGENTS.md hard rule: $title" $?
done
grep -q 'Alpha' AGENTS.md 2>/dev/null; check "AGENTS.md says Alpha" $?
missing=""
for s in $(grep -oE 'skills/[a-z-]+/SKILL\.md' AGENTS.md 2>/dev/null | sort -u); do [ -f "$s" ] || missing="$missing $s"; done
[ -z "$missing" ] && grep -q 'skills/evaluate/SKILL.md' AGENTS.md 2>/dev/null; check "every skill AGENTS.md names exists${missing:+:$missing}" $?

# CLAUDE.md
[ "$(cat CLAUDE.md 2>/dev/null)" = 'Read AGENTS.md and follow it.' ] && [ "$(wc -l < CLAUDE.md | tr -d ' ')" = 1 ]
check "CLAUDE.md is exactly the one line" $?

# Commands
for c in $COMMANDS; do
  f=".claude/commands/$c.md"
  [ -f "$f" ] && grep -q "skills/$c/SKILL.md" "$f" && [ -f "skills/$c/SKILL.md" ]
  check "$f names an existing skills/$c/SKILL.md" $?
  head -1 "$f" 2>/dev/null | grep -qx -- '---' && grep -q '^description: ' "$f"
  check "$f has a description front matter" $?
done

# Skills
for s in $SKILLS; do
  f="skills/$s/SKILL.md"
  [ -f "$f" ] && [ "$(head -1 "$f")" = '---' ] \
    && awk 'NR>1 && /^---$/{exit} NR>1' "$f" | grep -qx "name: $s" \
    && awk 'NR>1 && /^---$/{exit} NR>1' "$f" | grep -qE '^description: .{20,}'
  check "$f has front matter with name and description" $?
done

AGENT_FILES=(AGENTS.md CLAUDE.md README.md)
for f in skills/*/SKILL.md .claude/commands/*.md; do [ -f "$f" ] && AGENT_FILES+=("$f"); done

# Every flag on a line that names a harness tool exists in one of the tools that line names.
bad=""
while IFS= read -r line; do
  tools=()
  for t in e2e/run-e2e.sh e2e/lint.sh e2e/lib/promote.mjs e2e/lib/scrub.mjs e2e/lib/report.mjs; do
    case "$line" in *"$(basename "$t")"*) tools+=("$t") ;; esac
  done
  [ ${#tools[@]} -gt 0 ] || continue
  for flag in $(printf '%s\n' "$line" | grep -oE '(^|[ `(\[])--[a-z][a-z-]*' | sed -E 's/^[ `(\[]//' | sort -u); do
    name="${flag#--}"
    found=1
    for t in "${tools[@]}"; do grep -qE -- "(--|')$name([^a-z-]|$)" "$t" && found=0; done
    [ $found -eq 0 ] || bad="$bad $flag(${tools[*]})"
  done
done < <(cat skills/*/SKILL.md AGENTS.md 2>/dev/null)
[ -z "$bad" ]; check "every harness flag the skills use exists${bad:+:$bad}" $?
for flag in --track --list --custom --update-screenshots --lint --report-only; do
  grep -qE -- "^ *$flag\)" e2e/run-e2e.sh && grep -qF -- "$flag" skills/*/SKILL.md 2>/dev/null
  check "run-e2e.sh flag $flag is handled and used by a skill" $?
done

# Every e2e/lib path the skills name exists.
missing=""
for p in $(cat skills/*/SKILL.md AGENTS.md 2>/dev/null | grep -oE 'e2e/lib/[A-Za-z0-9_.-]+\.(sh|mjs|ts)' | sort -u); do
  [ -f "$p" ] || missing="$missing $p"
done
[ -z "$missing" ]; check "every e2e/lib path in the skills exists${missing:+:$missing}" $?
for p in e2e/lib/detect-env.sh e2e/lib/session-log.sh e2e/lib/scrub.mjs e2e/lib/promote.mjs e2e/lib/compare.mjs; do
  grep -qF "$p" skills/*/SKILL.md 2>/dev/null; check "a skill uses $p" $?
done

# README
alpha=$(grep -n '^## Alpha: Evaluate with an agent$' README.md | cut -d: -f1)
start=$(grep -n '^## Start here$' README.md | cut -d: -f1)
prereq=$(grep -n '^## Prerequisites$' README.md | cut -d: -f1)
[ -n "$alpha" ] && [ -n "$start" ] && [ -n "$prereq" ] && [ "$prereq" -lt "$alpha" ] && [ "$alpha" -lt "$start" ]
check "README has the Alpha section between Prerequisites and Start here" $?
sect=$(awk '/^## Alpha: Evaluate with an agent$/{on=1; next} /^## /{on=0} on' README.md)
printf '%s' "$sect" | grep -qF '[AGENTS.md](AGENTS.md)'; check "README Alpha section links AGENTS.md" $?
for w in /evaluate /adapt-lab '/contribute-lab <name>' 'custom-labs/<name>/'; do
  printf '%s' "$sect" | grep -qF -- "$w"; check "README Alpha section names $w" $?
done
[ "$(printf '%s\n' "$sect" | awk 'NF{if(!p)n++; p=1; next}{p=0} END{print n+0}')" -eq 3 ]
check "README Alpha section has three paragraphs" $?

# Prose
hits=$(grep -l $'\xe2\x80\x94' "${AGENT_FILES[@]}" 2>/dev/null)
[ -z "$hits" ]; check "no em dashes in the agent files${hits:+: $hits}" $?
hits=$(grep -il 'prospect' "${AGENT_FILES[@]}" .mcp.json 2>/dev/null)
[ -z "$hits" ]; check "no 'prospect' in the agent files${hits:+: $hits}" $?
grep -qF 'http://localhost:15000/ui' skills/adapt-lab/SKILL.md 2>/dev/null; check "adapt-lab names the UI the Playwright MCP may drive" $?

# .mcp.json
node -e '
const j = JSON.parse(require("fs").readFileSync(".mcp.json", "utf8"));
const s = j.mcpServers || {};
const k = s["solo-knowledge"], p = s.playwright;
if (!k || k.type !== "http" || k.url !== "https://knowledge-base.soloio-field.com/mcp") process.exit(1);
if (!p || p.command !== "npx" || !Array.isArray(p.args)) process.exit(1);
const pkg = p.args.find((a) => a.startsWith("@playwright/mcp@"));
if (!pkg || !/^@playwright\/mcp@\d+\.\d+\.\d+$/.test(pkg)) process.exit(1);
if (Object.keys(s).length !== 2) process.exit(1);
const oi = p.args.indexOf("--allowed-origins");
if (oi < 0 || p.args[oi + 1] !== "http://localhost:15000") process.exit(1);
' 2>/dev/null
check ".mcp.json parses, has solo-knowledge, playwright pinned to a version and limited to localhost:15000" $?

# Lint: clean apart from the three stale metrics-and-tracing PNGs, which are the user's to delete.
out=$(e2e/lint.sh 2>&1); rc=$?
[ $rc -eq 0 ] && [ "$out" = "lint ok" ]
check "e2e/lint.sh passes on the shipped labs${out:+: $out}" $?

printf '\n%s passed, %s failed\n' "$T_PASS" "$T_FAIL"
[ "$T_FAIL" -eq 0 ]
