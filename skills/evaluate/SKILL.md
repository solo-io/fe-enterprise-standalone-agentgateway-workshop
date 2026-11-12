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
- Nothing about their gateway leaves the machine except through their model provider, and the only service you query is the Solo docs server, with generic product questions.
- If a lab fails, you stop, explain, and they decide what happens next.

## 2. Detect the environment

Start a fresh session log, so the report holds only this session's labs:

```bash
e2e/lib/session-log.sh start
```

Apply `skills/detect-environment/SKILL.md`. Continue only when detection exits 0, every leftover project it found is handled, and `setup_config_dirty` is `false` or the user said the change is intended.

## 3. Choose track and mode

Ask which track to run if the user has not said: `llm`, `mcp`, `platform`, or `all`. Offer this heuristic: the LLM track if their interest is model access, cost, and guardrails; the MCP track if it is tools and agents; the platform track for UI access, TLS, Postgres, and metrics. The `llm` and `all` tracks start with `001`.

Ask for the mode:

- `enablement` (default): one spec per call, an explanation before each lab, and a stop on the first failure.
- `rig`: one `--track` call runs every spec, keeps going after a failure, and you report every failure at the end.

Record the answer, with `<t>` as the track and `<m>` as the mode:

```bash
e2e/lib/session-log.sh add decision - "track=<t> mode=<m>"
```

## 4. Show the plan

```bash
e2e/run-e2e.sh --list --track <t>
```

It runs nothing. Each lab is one tab-separated line: the id, the lab path, and the helper profiles (`-` for none). The key check's lines follow, for example `ANTHROPIC_API_KEY: not set, Anthropic tests skip`.

Show the labs grouped by the sub-headings of the track's table in `README.md`, in the order the list prints them. Name:

- the labs whose tests will skip for a missing or rejected key: join the key-check lines against the **Needs** column of `README.md`. If any key is missing, stop and name the variable and the labs it gates, then offer two choices: the user adds it to `setup/.env` and says continue (run `--list` again), or the user continues and those labs skip. A missing or rejected `OPENAI_API_KEY` is different: the harness stops the run, so tell the user to fix it in `setup/.env` and run `--list` again. Never ask the user to paste a key into the chat, and never write a key yourself
- the labs that cost money: every lab that calls a provider. Most call OpenAI with `gpt-6-luna`, which costs little (the README's Prerequisites note). Ask before running each lab that also bills Anthropic, Bedrock, or TypeSafe. For each one the user declines, log it and pass `--skip <id>` on every later `run-e2e.sh` call; the report shows it as `SKIP (declined)`:

  ```bash
  e2e/lib/session-log.sh add decision <id> declined
  ```
- the helper profiles each lab starts, from the third column

Outcomes from earlier sessions stay in `e2e/.work/`, but the report leaves out every outcome older than the `session-log.sh start` of step 2, so it holds only this session's labs.

## 5. Run the labs

`rig` mode, with one `--skip <id>` per declined lab (leave `--skip` out when there are none):

```bash
e2e/run-e2e.sh --track <t> --skip <id>
```

The run ends with `ALL PASS (<n> labs)` or `FAILED: <ids>`. For each id under `FAILED:`, follow steps 1 and 2 of `skills/diagnose-failure/SKILL.md` and record the failure. Then offer the choices from that skill once, for the whole set, and run nothing until the user picks.

`enablement` mode: for each id from the list, in order:

1. If the user declined the lab, run `e2e/run-e2e.sh <id> --skip <id>` to record it and move on. Otherwise apply `skills/explain-lab/SKILL.md` to the lab.
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
