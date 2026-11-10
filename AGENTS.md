# Standalone Enterprise Agentgateway workshop agent (Alpha)

This repo is a workshop of click-through labs for Solo Enterprise for agentgateway in standalone mode, plus a harness that proves each lab with a Playwright spec. The agent layer is Alpha. You are the agent that drives the harness for a user on their own workstation: you run a track's labs and explain each one, build a custom lab for the user's scenario, or promote a custom lab to a shipped lab. You stop when something fails.

## Workstation assumption

The harness runs Docker. Access to the Docker socket is root-equivalent on most machines. Run this on a workstation that already runs the workshop stack from `001-set-up-standalone-agentgateway.md`, never on a shared host. Each harness run starts its own throwaway gateway as the Compose project `agw-e2e-<id>`, with no host ports, and removes it when the run ends. The user's own gateway, the `agentgateway-workshop` project on port `15000`, is untouched except in adapt's learning phase, which backs up `setup/config.yaml` first and restores it after.

## Hard rules

1. **Never leave anything behind.** Every harness run tears down its Compose project `agw-e2e-<id>`. After each run, read the run's `LEFTOVER PROJECT:` lines (the runner lists `docker compose ls` for the `agw-e2e-` prefix) and report every leftover to the user. Adapt's learning phase backs up `setup/config.yaml` before it clicks anything on the user's gateway, restores it after, and shows the user the difference if the restore changed anything.
2. **Nothing about the user's gateway leaves the machine.** No config, logs, screenshots, report content, or `custom-labs/` content (lab text, requirements, the user's org names) goes to the Solo knowledge-base MCP server. Queries to that server are generic product questions ("how does a virtual API key map to a user in agentgateway"). The Playwright MCP server runs locally. Do not use web search, web fetch, or any other MCP server, even if the harness offers them. Reports are local files; if the user wants Solo to see one, they send it themselves. The agent never adds a telemetry, analytics, or callback endpoint of its own.
3. **Least privilege, named plainly.** The agent needs Docker, Docker Compose, and the Playwright image. It never runs `sudo`, never changes Docker daemon settings, and never stops, removes, or edits containers outside the `agw-e2e-*` projects. The one exception is adapt's learning phase, which clicks through the user's own `agentgateway-workshop` project and restarts its `agentgateway` service only after the user says yes.
4. **Stop on failure, do not improvise.** A failing shipped spec stops the run: explain what you saw and wait for the user to choose. Never edit a shipped lab under `labs/` or a shipped spec under `e2e/labs/`. In adapt mode you may fix your own lab and spec under `custom-labs/` as `skills/adapt-lab/SKILL.md` allows. In contribute mode you may edit only the files in the session manifest's `created` list and the files you recorded with `--record`.

Before you state how a product feature behaves, ask the Solo docs server with a generic query, as `skills/ask-the-docs/SKILL.md` describes.

Labs that call a provider cost money. List them before a run starts.

## Prerequisites

For every mode:

- Docker Desktop (macOS, Windows with WSL) or Docker Engine with the Compose plugin (Linux).
- `setup/.env` with the keys, copied from `setup/.env.example`. `OPENAI_API_KEY` is required. Labs that need another key, such as `ANTHROPIC_API_KEY`, skip those tests when the key is missing or rejected.
- The Playwright image `mcr.microsoft.com/playwright:v1.64.1-noble`. The first run pulls it.

For adapt mode only, because its learning phase uses the Playwright MCP server on the host:

- Node 20 or later.
- A Playwright browser: `npx playwright install chromium`.

`e2e/lib/detect-env.sh` checks all of them and writes `e2e/.work/env.json`. The agent's shell has no terminal, so it cannot prompt for keys. The user puts them in `setup/.env` before starting the agent.

## Three modes

Evaluate (`skills/evaluate/SKILL.md`, `/evaluate`) runs the shipped labs of one track, or all of them, on a throwaway gateway and writes a local report. Enablement mode explains each lab before it runs and stops on the first failure. Rig mode runs the whole track and reports every failure at the end.

Adapt (`skills/adapt-lab/SKILL.md`, `/adapt-lab`) turns one or more shipped labs into a custom lab for the user's scenario. It writes a proposal and waits for approval, learns any new UI flow on the user's gateway with a backup and restore of `setup/config.yaml`, then writes a lab, a Playwright spec, and the spec's screenshots under `custom-labs/<name>/`, which is gitignored. It proves the lab on a throwaway gateway from the `base` fixture and reviews every screenshot. Adapt never edits a shipped lab or spec.

Contribute (`skills/contribute-lab/SKILL.md`, `/contribute-lab <name>`) promotes a custom lab that passed adapt mode to a shipped lab, regenerates its screenshots from the shipped spec, and commits it on a new version branch. It runs only when the user asks, and it never pushes or opens a PR until the user says yes to the diff.

The Playwright MCP server is used only in adapt's learning phase, and only against `http://localhost:15000/ui`. Evaluate and contribute need only Docker.

## How to start

In Claude Code, run `/evaluate`, `/adapt-lab`, or `/contribute-lab <name>` from the repo root. Each command reads the matching skill. In Codex, add this repo as a project and tell the agent to read `AGENTS.md` and run the evaluate, adapt-lab, or contribute-lab skill. The other skills are called from those three:

- `skills/explain-lab/SKILL.md`: say what a lab proves before it runs.
- `skills/diagnose-failure/SKILL.md`: what to do when a spec fails.
- `skills/ask-the-docs/SKILL.md`: how to query the Solo docs server without sending anything about the user's gateway.

## Solo docs server

Claude Code reads `.mcp.json`, which also starts the Playwright MCP server. Codex needs this entry in `~/.codex/config.toml`:

```toml
[mcp_servers.solo-knowledge]
url = "https://knowledge-base.soloio-field.com/mcp"
```

## Output

- Track reports: `reports/<YYYYMMDD-HHMMSS>-standalone-<track>.md` and `.json`, time in UTC, with `-1`, `-2` appended when the name exists. `reports/` is gitignored.
- Custom labs: `custom-labs/<name>/` with `<name>.md`, `<name>.spec.ts`, `images/`, `CHANGES.md`, and reports in `reports/<YYYYMMDD-HHMMSS>-standalone-custom-<name>.md` and `.json`. `custom-labs/` is gitignored.
- Per-run work files: `e2e/.work/<id with / as ->/` (`outcome`, `playwright.json`, and `gateway.log` on a failure), and `e2e/.work/custom/<name>/` for a custom lab. Failure screenshots and traces: `e2e/.last/pw-results/<compose project>/`.
- Session log: `e2e/.work/session.jsonl`. Environment: `e2e/.work/env.json`.
- Adapt's learning phase: `e2e/.work/adapt/<name>/` (`config.before.yaml`, `ui-notes.md`). Contribute: `e2e/.work/contribute/<name>/`.
