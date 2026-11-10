---
name: adapt-lab
description: Turn one or more shipped labs into a custom lab, a Playwright spec, and the spec's screenshots for the user's own scenario, prove it on a throwaway gateway, and hand it off. Use when the user wants to extend, compose, or reskin a lab for their scenario.
---

# Adapt a lab

Work from the repo root. Follow the steps in order. The four hard rules in `AGENTS.md` apply throughout. One session builds one custom lab.

A custom lab lives in `custom-labs/<name>/`, which is gitignored:

```
custom-labs/<name>/
  <name>.md        the lab
  <name>.spec.ts   the Playwright spec; line 1 is // custom-labs/<name>/<name>.md
  images/          NN-<what>.png, written by the spec
  CHANGES.md       source labs, deltas, requirement-to-test table
  reports/         written by --report-only
```

Never edit a shipped lab under `labs/`, a shipped spec under `e2e/labs/`, or a shipped screenshot under `images/`.

## 1. Set expectations

Tell the user, in four sentences:

- Nothing is written or clicked until they approve a written proposal.
- The result is a lab they can follow by hand, a Playwright spec that replays it, and the screenshots the spec wrote, all under `custom-labs/<name>/`.
- If the lab needs a UI flow the shipped specs do not cover, you click through it in a learning phase on a separate throwaway gateway, never on their own.
- Validation runs on a throwaway gateway, so the screenshots in the lab come from a clean `base` state, and nothing about their gateway or requirements leaves the machine except through their model provider. The only service you query is the Solo docs server, with generic product questions.

## 2. Intake

Start a fresh session log:

```bash
e2e/lib/session-log.sh start
```

Apply `skills/detect-environment/SKILL.md`. Continue only when detection exits 0, every leftover project it found is handled, and `setup_config_dirty` is `false` or the user said the change is intended. If `playwright_mcp_image` is `pull needed` and the lab turns out to need a learning phase, say that the phase pulls the image first, which takes a few minutes.

Recommend once that the user run the source labs, or their track, with `/evaluate` first, so the custom work starts from labs known to pass. They may decline.

The user names one or more source labs or describes the scenario. When they describe it, find the closest labs from the track tables in `README.md`, read each candidate lab and its spec under `e2e/labs/<track>/`, and confirm the choice with the user. The request is usually one of these:

- Extend: keep one lab's pattern and scale it, for example three virtual keys with different limits instead of two keys.
- Compose: join two labs, for example virtual API keys plus a token rate limit per key.
- Reskin: keep a lab's mechanics and swap in the user's organization: team names, models, limits.

Ask only for what you cannot infer from the labs: names, models, limits, which tools. Ask one question at a time. Agree a name for the lab with the user. Use lowercase letters, digits, and hyphens, starting with a letter or digit, for example `team-keys-token-limits`; the harness refuses any other name. Pick a name that does not exist yet under `custom-labs/`.

Write every requirement as a numbered, testable statement in the user's terms, for example: "R1: A request with the `support` key over 500 tokens per minute gets HTTP 429, and the `research` key still gets 200." Push an untestable statement back to the user and ask for a testable version.

## 3. Proposal

Answer product questions with `skills/ask-the-docs/SKILL.md`. Queries name the product and the feature only, never the user's requirements, names, or lab text.

Write `custom-labs/<name>/CHANGES.md` from this template and show it:

```markdown
# <name>

## Source labs

- labs/<track>/<lab>.md: keeps <sections>, changes <sections>, drops <sections>

## What the UI writes

| Config key | Value | What it does |
|------------|-------|--------------|

## Requirements

| Id | Requirement | Lab step | Spec test | Positive | Negative |
|----|-------------|----------|-----------|----------|----------|
| R1 | <statement> | <Step N heading> | [R1] <test title> | <action and expected result> | <action and expected deny> |

## Interaction check

<For a compose: which source-lab results must still hold with both configurations in place.>

## Open questions

<What the labs and the docs server could not confirm, with the user's options.>

## Footprint

- Helper profiles: <list from setup/docker-compose.yml, or none>
- Host ports: <the gateway ports the lab uses; a custom lab adds no new host port>
- External endpoints: <list, marking each one that costs money>
- Learning phase: <the UI flows you will click through on the learning gateway, or none>

## Changes during validation

<Filled in at hand-off.>
```

Read the "What the UI writes" rows from the source labs' "What the UI wrote" sections.

The user approves, edits, or stops. Nothing is written beyond `CHANGES.md`, and nothing is clicked, before the user approves the proposal.

```bash
e2e/lib/session-log.sh add decision custom/<name> "proposal approved: sources=<labs> requirements=<count>"
```

## 4. Learning phase

Run this only after approval, and only for UI flows the source specs do not already cover. If the shipped specs already click every control the lab needs, take their locators from the specs and skip to step 5.

The learning phase runs on a throwaway gateway, the Compose project `agw-e2e-learn`, started from the `base` fixture. The user's own gateway takes no part. The Playwright MCP server runs in a container on the learning gateway's network, where `http://localhost:15000` is the learning gateway, and `--allowed-origins` blocks every other origin. Drive only `http://localhost:15000/ui`.

1. Start the learning gateway with the helper profiles from the proposal's Footprint. Leave out `--profiles` when there are none:

   ```bash
   e2e/run-e2e.sh --learn <name> --profiles <profile>,<profile>
   ```

   It ends with `LEARN READY agw-e2e-learn` and saves the starting config to `e2e/.work/adapt/<name>/config.before.yaml`. It refuses to start when `agw-e2e-learn` already exists and prints how to stop it.
2. Connect the browser. In Claude Code, ask the user to run `/mcp` and reconnect the `playwright` server, and wait until they say it is connected. In Codex, ask the user to restart Codex. Before the learning gateway is up, the server exits with a message that no learning gateway is running.
3. Drive `http://localhost:15000/ui` with the Playwright MCP: navigate, take a snapshot, click, and read labels. For each control the lab uses, record the page path, its role, and its accessible name in `e2e/.work/adapt/<name>/ui-notes.md`, for example `/llm/keys: button "New key"; dialog textbox "Name"`. The spec needs these for `getByRole` locators. Note any toast or dialog that appears after a save. The browser is headless; take a screenshot with the MCP when you need to see a page.
4. Read what the UI wrote:

   ```bash
   e2e/run-e2e.sh --learn <name> --diff
   ```

   It saves `e2e/.work/adapt/<name>/config.after.yaml` and prints the differences against `config.before.yaml`, ignoring UI metadata. Exit 0 means the clicks changed nothing; exit 2 means they did. Check the "What the UI writes" table in `CHANGES.md` against the differences and correct it.
5. If a flow takes effect only after a gateway restart, restart the learning gateway. The browser keeps its network:

   ```bash
   e2e/run-e2e.sh --learn <name> --restart
   ```

6. Stop the learning gateway:

   ```bash
   e2e/run-e2e.sh --learn <name> --stop
   ```

   It saves the final config and removes `agw-e2e-learn`. A `LEFTOVER PROJECT: agw-e2e-learn` line means the project is still there: show it, and on the user's yes run `docker compose -p agw-e2e-learn down -v`.

Log the result:

```bash
e2e/lib/session-log.sh add decision custom/<name> "learning phase: <flows learned>, config diff <none|recorded>"
```

## 5. Build and validate

Write `custom-labs/<name>/<name>.md` following "Writing the lab" and `custom-labs/<name>/<name>.spec.ts` following "Writing the spec". Then loop:

1. Lint. It runs without a gateway. Fix your own authoring until it prints `lint ok`:

   ```bash
   e2e/run-e2e.sh --custom <name> --lint
   ```

   It checks the lab skeleton, links, em dashes, line 1 of the spec, that every `// @req R<n>` line has a `[R<n>]` test title and the reverse, that the literal `shot(page, 'NN-<what>'` names equal the lab's `images/NN-<what>.png` references and the PNG files in `images/`, the `../lib/` import prefix, and that the spec's `// @profiles` and the lab's `--profile` flags name the same profiles, all defined in `setup/docker-compose.yml`. On the first pass, before any run, `images/` is empty, so expect `missing image:` lines and, for this lab's own screenshots, `broken link: images/NN-<what>.png` lines. Fix any other line.

2. Run on a throwaway gateway from the `base` fixture. The run moves the PNGs in `custom-labs/<name>/images/` aside first and the spec writes every screenshot again. If the run does not pass, the previous PNGs come back:

   ```bash
   e2e/run-e2e.sh --custom <name> --update-screenshots
   ```

   Read the outcome line from `e2e/.work/custom/<name>/outcome` and log it:

   ```bash
   e2e/lib/session-log.sh add run custom/<name> "<outcome line>"
   ```

   Only `status=pass` with `rc=0` counts. `skipped=<n>` above 0 is not a pass: a skipped `[R<n>]` test leaves that requirement unproven. `rc=2` with `config_mismatch=1` is a Clean up bug: the config did not return to `base`. Fix the lab's Clean up section and the spec's `clean up` test, then run again.

3. Review every screenshot the run wrote. Open each PNG under `custom-labs/<name>/images/` with a file-reading tool that renders images, so you see it. Each must show the page and dialog the step describes, with the red outline on the control the step names. A screenshot of a loading state, an error toast the step does not describe, or the wrong page is an authoring bug: move or re-target the `shot()` call and run step 2 again.

4. On a failing test, apply `skills/diagnose-failure/SKILL.md` with the id `custom/<name>`: read the Playwright JSON, the trace, and the failure screenshot under `e2e/.last/pw-results/agw-e2e-custom-<name>/`, and explain what the UI did against what the lab expected. Replace that skill's choices with these:

   - Fix the authoring, within the rule below
   - Record a gap
   - Stop

   Run nothing until the user picks.

5. A `LEFTOVER PROJECT: <name>` line fails the run. Show it to the user, and on their yes remove it:

   ```bash
   docker compose -p <project> down -v
   ```

   Then find what held it, such as a helper the spec started outside its profiles, fix it, and run again.

You may fix your own authoring: locators, waits, step order, screenshot targets, and copy. You may not change a requirement, loosen an assertion, or invent UI steps the gateway does not offer. If the UI cannot meet a requirement, report it to the user as a gap. If the user wants to keep the rest, the lab states the gap in a callout and `CHANGES.md` records it.

A pass means all of these hold:

- `--custom <name> --lint` prints `lint ok`, including screenshot agreement and requirement coverage.
- The last run's outcome is `status=pass rc=0` with `skipped=0` and `leftover=0`.
- Every requirement has at least one passing `[R<n>]` test with a positive and a negative assertion. The negative assertion exercises the deny path: the 401, the 429, the blocked prompt, the hidden tool, the `isError` reply. A saved form or a row in a list is never the assertion for a requirement.
- For a compose, the interaction check tests are present and pass.
- You reviewed every screenshot after the last run.
- Clean up returns the config to `base`.
- No leftover project remains.

Answer product questions during the loop with `skills/ask-the-docs/SKILL.md`.

## 6. Hand-off

Fill in "Changes during validation" in `CHANGES.md`: what changed and why. Build the report:

```bash
e2e/run-e2e.sh --report-only --custom <name>
```

It writes `custom-labs/<name>/reports/<YYYYMMDD-HHMMSS>-standalone-custom-<name>.md` and `.json`. Its `## Requirements` table shows PASS, FAIL, or NOT RUN for each `R<n>`; every row must be PASS.

Show the four paths: `custom-labs/<name>/<name>.md`, `custom-labs/<name>/<name>.spec.ts`, `custom-labs/<name>/images/`, and the report. Tell the user they can follow the lab by hand against their own gateway, or re-run the proof with `e2e/run-e2e.sh --custom <name>`. The folder is theirs and stays on their machine. To ship it in the workshop, they run `/contribute-lab <name>`.

Nothing needs removing: the throwaway gateways are gone, and the user's gateway and `setup/config.yaml` were never changed.

## Writing the lab

Follow `style-guide.md` and `skills/stop-slop/SKILL.md`. Write in second person, use no em dashes, no filler words, and no commentary about the lab itself.

The skeleton, in this order:

- `# <Outcome title in Title Case>`
- `## Before you start`: a link to `[001: Set Up Standalone Agentgateway](../../001-set-up-standalone-agentgateway.md)`, the keys the lab needs from `setup/.env`, and the helper profile it starts.
- `## What you'll do`: verb-first bullets.
- `## Why this matters`: two to four sentences, optional.
- `## Set up`: the same steps and screenshots as the intro lab for each thing used. For the `openai/*` model, copy the Set up of `labs/llm/virtual-api-keys.md`, whose images point at `../../images/llm/connect-llm-providers/`. For MCP, copy it from a lab that starts from `labs/mcp/connect-remote-mcp-server.md`.
- `## Step N: <action>` sections: one numbered list of UI actions each, one action per item, then the screenshot after the list item it illustrates. Name the sidebar page first, then the control, with the exact label text in bold. Values the user types go in code spans.
- `## Check it`: the result in a playground, Logs, or Analytics, with a screenshot.
- An optional curl check inside `<details><summary>Optional: check with curl</summary>`, with `Expected output:`.
- `## What the UI wrote`: the YAML from **Raw Configuration**, in block style, never inline flow style.
- `## Clean up`: UI steps that return the config to `base`, ending with the sentence that the gateway is back to the state 001 left it in. A top-level key left empty, such as `gateways: {}`, fails the harness's config check, so Clean up deletes it.

Rules:

- Image paths for this lab's own screenshots are `images/NN-<what>.png`, relative to the lab file, numbered in step order from `01`. Each must match a `shot()` name in the spec. Set up screenshots borrowed from an intro lab keep their `../../images/<track>/<slug>/` paths; the spec takes `shot()` calls only for this lab's own images.
- Start helpers with the README's command from the `setup` folder, `env UID=$(id -u) GID=$(id -g) docker compose --profile <helper> up -d`, using only profiles `setup/docker-compose.yml` defines. A custom lab adds no host port and no new helper service.
- Every command the spec runs with `labSh` or `labExec` appears verbatim in a fenced code block of the lab.
- Secrets come from `setup/.env` by name, for example **Env var** `OPENAI_API_KEY`. The lab never contains a key value, token, hostname, or IP from the user's environment. Values the user supplied, such as team names, models, and limits, belong in the lab.
- Keep headings unique within the lab.

## Writing the spec

Model the spec on the source labs' specs under `e2e/labs/<track>/`, for example `e2e/labs/llm/virtual-api-keys.spec.ts`. The header and skeleton:

```typescript
// custom-labs/<name>/<name>.md
// @fixture base
// @profiles <helper>
// @req R1 A request without a virtual key gets HTTP 401
// @req R2 The support key gets HTTP 429 after its token budget
import { expect, test } from '@playwright/test';
import { chatRequest, lab } from '../lib/lab';
import { expectMatchesFixture } from '../lib/config';
import { addOpenAIModel, deleteModel } from '../lib/setup';

const { go, shot, save } = lab('custom', '<name>');

test.describe.configure({ mode: 'serial' });

test('set up', async ({ page }) => {
  await addOpenAIModel(page);
});

test('[R1] a request without a key is rejected and a valid key is accepted', async ({ page }) => {
  await go(page, '/llm/keys');
  const enable = page.locator('main').getByRole('button', { name: 'Enable API key auth' }).last();
  await shot(page, '01-keys-disabled', enable);
  // ...the UI steps of the lab, each followed by the expect that proves it
  const denied = await chatRequest('openai/gpt-6-luna', 'Hello');
  expect(denied.status).toBe(401);
});

test('[R2] the support key is limited after its budget', async ({ page }) => {
  // ...positive: a request under the budget gets 200; negative: the next one gets 429
});

test('clean up', async ({ page }) => {
  // ...the lab's Clean up steps through the UI
  await deleteModel(page);
  expectMatchesFixture('base');
});
```

Rules:

- Line 1 is `// custom-labs/<name>/<name>.md`, so `labSh` checks commands against this lab. `// @fixture base` always. Add `// @profiles` only for helpers the lab starts. Add one `// @req R<n> <text>` line per requirement, in the user's words.
- Import only from `../lib/lab`, `../lib/setup`, and `../lib/config`, plus `@playwright/test`. The harness copies the spec to `e2e/custom/` before the run, so these paths resolve.
- `const { go, shot, save } = lab('custom', '<name>')`. `go(page, '/llm/keys')` opens a UI page and waits for it. `save(page, 'Save')` clicks a save button and waits for the save to land.
- `test.describe.configure({ mode: 'serial' })`. One `set up` test with the shared helpers from `../lib/setup` (`addOpenAIModel`, `enableMcp`, `addMcpServer`, `applyMcpCors`, `setUpSoloDocs`). Step tests titled `[R<n>] <what it proves>`. One `clean up` test that ends with `expectMatchesFixture('base')`.
- Screenshots: `shot(page, 'NN-<what>', <locator>)` with the name as a string literal, numbered in step order, with a target locator wherever the step names a control, so the image shows the red outline on it. Take the shot after the page has settled on the state the step describes.
- Locators use `getByRole` with the roles and accessible names from the source specs or `e2e/.work/adapt/<name>/ui-notes.md`, scoped to `page.locator('main')` or `page.getByRole('dialog')`.
- Assertions use `expect` on the UI, and `chatRequest` or `labSh` for the curl checks. `labSh` runs the lab's exact command from `setup/` and fails if the command is not in a code block of the lab. A `tools/call` denial on MCP is HTTP 200 with `"isError":true` in the body, as `e2e/labs/mcp/mcp-rate-limiting.spec.ts` shows, so check the body, not the status.
- Tests that need a key other than `OPENAI_API_KEY` call `test.skip(!HAS_ANTHROPIC, 'ANTHROPIC_API_KEY not set')` or the matching `HAS_*` flag from `../lib/lab`. A skipped `[R<n>]` test does not prove its requirement.
