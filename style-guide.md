# Lab Style Guide

These rules apply to every lab in this workshop. Readers are mid-market teams and non-technical users who follow screenshots and click through the agentgateway UI.

## Repo layout

| Path | Contents |
|---|---|
| `001-set-up-standalone-agentgateway.md` | Setup lab. Every other lab starts here. |
| `labs/llm/<slug>.md`, `labs/mcp/<slug>.md`, `labs/platform/<slug>.md` | Track labs. |
| `setup/` | The reader's Docker Compose stack, starting `config.yaml`, `.env.example`, helper service files. |
| `images/<track>/<slug>/NN-<what>.png` | Screenshots, written by the lab's spec. |
| `lib/jwt/` | Workshop JWKS and pre-made tokens. |
| `e2e/` | Validation harness and one spec per lab. |

## Standalone labs

Every lab starts from `base`, the state `001` leaves. A lab sets up what it uses in a `## Set up` section, with the same steps and screenshots as the intro lab for that thing:

| Lab needs | Set up steps from | Cleanup |
|---|---|---|
| The `openai/*` model | `labs/llm/connect-llm-providers.md` | Delete the model on **Models** |
| MCP and an MCP server | `labs/mcp/connect-remote-mcp-server.md` | Turn off MCP: delete from `gateways:` to the end of the file in **Raw Configuration** |

Add only what the lab uses. Every lab's cleanup returns the config to `base`. Make a lab require another lab only when it continues that lab, for example a long lab split into two parts.

## Lab skeleton

```
# <Outcome title in Title Case>

## Before you start          link to 001; keys; helper profile
## What you'll do            verb-first bullets
## Why this matters          2 to 4 sentences, optional
## Set up                    the model, MCP and servers the lab uses (see Standalone labs)
## Step 1: <action>          UI instructions, then the screenshot
## Step 2: <action>
## Check it                  result in a playground or Logs, with a screenshot
<details> Optional: check with curl </details>
## What the UI wrote         the YAML the UI saved, from Raw Configuration
## Clean up                  UI steps back to base
```

## Writing UI steps

- Name the sidebar page first, then the control: "In the sidebar, click **Virtual API Keys**, then click **New key**."
- Use the exact label text on screen, in bold.
- One numbered list per step. One action per list item.
- Put the screenshot after the list it illustrates: `![Short description](../../images/llm/<slug>/02-new-key.png)` (relative to the lab file).
- Values the reader types go in code spans: enter `alice` in **Name**.
- Long values (JWKS, tokens, schemas) go in a fenced block the reader copies.

## Checking results

- Check in the UI first: Chat Playground, Tool Playground, Logs, Analytics.
- Add a curl check inside a collapsed block:

  ````
  <details>
  <summary>Optional: check with curl</summary>

  ```bash
  curl -s http://localhost:4000/v1/chat/completions ...
  ```

  Expected output:

  ```
  ...
  ```

  </details>
  ````

- Expected output shows what the reader will see. Trim long JSON with `...`.

## Screenshots

- The lab's spec writes them: `e2e/run-e2e.sh <id> --update-screenshots`. Do not edit them by hand.
- 1440x900, light theme. The element to click has a red outline.
- Name them `NN-<what>.png` in step order, starting at `01`.

## Prose

- Follow the stop-slop rules: plain words, no filler, no em dashes, name the actor.
- Say what the reader does and what they will see. Explain why in one or two sentences where it helps.
- Second person ("you").

## Validation

A lab ships only when its spec passes:

```bash
e2e/run-e2e.sh <id> --update-screenshots
e2e/lint.sh
```

The spec performs every step of the lab through the UI, checks each result, runs the cleanup steps, and the harness checks the config matches the start state. A top-level key left empty, such as `gateways: {}`, fails that check, so the Clean up must delete it. The spec runs the lab's commands with `labSh`, which fails if the command is not in a code block of the lab. `labExec` does the same for a `docker compose exec <service> ...` command, and `inLab` checks a command that the spec runs another way, such as a restart with `helper()`. If the lab text and the spec disagree, the lab is wrong.

## Adding a lab

1. Write the spec in `e2e/labs/<track>/<slug>.spec.ts` with `// @fixture`, and `// @profiles` if it needs helpers.
2. Write the lab in `labs/<track>/<slug>.md`, step for step with the spec.
3. Run the spec with `--update-screenshots`, then `e2e/lint.sh`.
4. Link the lab in `README.md` and add a `CHANGELOG.md` entry.
