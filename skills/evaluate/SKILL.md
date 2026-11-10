---
name: evaluate
description: Run the shipped labs of a track on a throwaway standalone gateway, explain each one, stop on failure, and write a local report. Use when the user asks to evaluate, try, or test standalone Enterprise Agentgateway with the workshop labs.
---

# Evaluate standalone Enterprise Agentgateway

Work from the repo root. Follow the steps in order. The four hard rules in `AGENTS.md` apply throughout.

## 1. Set expectations

Tell the user, in four sentences:

- The labs run on a throwaway gateway that Docker Compose starts for each lab, so their own gateway on port `15000` is untouched.
- Every run tears its Compose project down, and you report any project left behind.
- Nothing about their gateway leaves the machine; the only outbound call is a generic product question to the Solo docs server.
- If a lab fails, you stop, explain, and they decide what happens next.

## 2. Detect the environment

Run:

```bash
e2e/lib/detect-env.sh
```

Exit 0: continue. Exit 2: stop and show the lines it printed; each names a missing item (Docker, the Compose plugin, `setup/.env`, or a working `OPENAI_API_KEY`). Ask the user to fix it and start again.

Read `e2e/.work/env.json`:

- `leftover_projects`: if it lists any `agw-e2e-*` project, name each one and offer to remove it. On a yes, for each name:

  ```bash
  docker compose -p <name> down -v
  ```

  Remove nothing outside the `agw-e2e-` prefix.
- `playwright_image`: `pull needed` means the first run pulls the Playwright image, which takes a few minutes. Say so.
- `user_gateway`: informational. Evaluate never uses it.
- `keys`: a key that is `missing` or `rejected` makes the tests that need it skip.

## 3. Choose track and mode

Ask which track to run if the user has not said: `llm`, `mcp`, `platform`, or `all`. Offer this heuristic: the LLM track if their interest is model access, cost, and guardrails; the MCP track if it is tools and agents; the platform track for UI access, TLS, Postgres, and metrics. The `llm` and `all` tracks start with `001`.

Ask for the mode:

- `enablement` (default): one spec per call, an explanation before each lab, and a stop on the first failure.
- `rig`: one `--track` call runs every spec, keeps going after a failure, and you report every failure at the end.

Start a fresh session log, then record the answer, with `<t>` as the track and `<m>` as the mode:

```bash
e2e/lib/session-log.sh start
e2e/lib/session-log.sh add decision - "track=<t> mode=<m>"
```

If `setup_config_dirty` in `e2e/.work/env.json` is `true`, stop here. Tell the user why: the harness uses the working-tree `setup/config.yaml` as the `base` fixture, and their own gateway writes to that file on every click, so every throwaway run would start from and be checked against the wrong state. They can see the change with `git diff -- setup/config.yaml`. Restoring the file is their decision and their command; never restore it yourself. Continue only when they have restored it and `e2e/lib/detect-env.sh` reports `setup_config_dirty: false`, or they say the change is intended. Log the answer:

```bash
e2e/lib/session-log.sh add decision - "setup/config.yaml differs from HEAD: <restored|intended>"
```

If `setup_config_dirty_error` is set, show it and stop; the check could not read git.

## 4. Show the plan

```bash
e2e/run-e2e.sh --list --track <t>
```

It runs nothing. Each lab is one tab-separated line: the id, the lab path, and the helper profiles (`-` for none). The key check's lines follow, for example `ANTHROPIC_API_KEY: not set, Anthropic tests skip`.

Show the labs grouped by the sub-headings of the track's table in `README.md`, in the order the list prints them. Name:

- the labs whose tests will skip for a missing or rejected key: join the key-check lines against the **Needs** column of `README.md`
- the labs that cost money: every lab that calls a provider. Most call OpenAI with `gpt-6-luna`, which costs little (the README's Prerequisites note); labs that call Anthropic, Bedrock, or TypeSafe bill those accounts too
- the helper profiles each lab starts, from the third column

Outcomes from earlier sessions stay in `e2e/.work/`, but the report leaves out every outcome older than the `session-log.sh start` of step 3, so it holds only this session's labs.

## 5. Run the labs

`rig` mode:

```bash
e2e/run-e2e.sh --track <t>
```

The run ends with `ALL PASS (<n> labs)` or `FAILED: <ids>`. For each id under `FAILED:`, follow steps 1 and 2 of `skills/diagnose-failure/SKILL.md` and record the failure. Then offer the choices from that skill once, for the whole set, and run nothing until the user picks.

`enablement` mode: for each id from the list, in order:

1. Apply `skills/explain-lab/SKILL.md` to the lab.
2. Run the spec and show the `=== <id>: PASS` or `FAIL` line:

   ```bash
   e2e/run-e2e.sh <id>
   ```

3. Read the outcome line from `e2e/.work/<id with / as ->/outcome`, for example `e2e/.work/llm-virtual-api-keys/outcome`, and log it:

   ```bash
   e2e/lib/session-log.sh add run <id> "<outcome line>"
   ```

   `status=pass` is a pass. A pass with `skipped=<n>` above 0 means tests skipped for a missing key; say which. `status=fail` is a failure, including a run whose tests passed but printed `LEFTOVER PROJECT: <name>` (`leftover=<n>` above 0) or ended with `rc=2 config_mismatch=1` (the lab's Clean up did not return the config to `base`).
4. On `status=fail`, apply `skills/diagnose-failure/SKILL.md` and do nothing else until the user chooses.

After the last lab of each README sub-heading, pause and invite questions. Answer product questions with `skills/ask-the-docs/SKILL.md`.

In both modes, every `LEFTOVER PROJECT: <name>` line is a project the run did not remove. Name it to the user and offer `docker compose -p <name> down -v`. A `PRE-EXISTING PROJECT: <name>` line is a project that was there before the run; it is informational.

Never edit a shipped lab under `labs/` or a shipped spec under `e2e/labs/`.

## 6. Build and show the report

```bash
e2e/run-e2e.sh --report-only --track <t>
```

It runs nothing and prints two paths: `reports/<YYYYMMDD-HHMMSS>-standalone-<t>.md` and `.json`. Show them. To compare with an earlier report of the same track:

```bash
node e2e/lib/report.mjs compare <older.json> <newer.json>
```

There is no base install to remove. Tell the user their own gateway was never touched, and confirm that no `agw-e2e-*` project remains:

```bash
docker compose ls -a
```

List any `agw-e2e-*` project it shows as a leftover. Say the report is a local file and nothing was sent anywhere. If the user wants Solo to see it, they send it themselves.
