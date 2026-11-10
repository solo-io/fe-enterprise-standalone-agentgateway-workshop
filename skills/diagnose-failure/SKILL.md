---
name: diagnose-failure
description: Handle a spec run that ended with status=fail. Read the Playwright result, the gateway log, and the failure screenshot, explain it, offer choices, and wait. Use whenever a lab or custom lab run fails.
---

# Diagnose a failed run

The harness has already finished the run and removed its Compose project. `<id>` is the lab id, for example `mcp/mcp-rate-limiting`, or `custom/<name>` for a custom lab. `<dir>` is its work folder: `e2e/.work/<id with / as ->/`, for example `e2e/.work/mcp-mcp-rate-limiting/`, or `e2e/.work/custom/<name>/`. Do these steps, in order, and nothing else.

1. Read what failed:

   - `<dir>/outcome`: the status line. `rc=1` is a failing test, and `reason=` names the first failing test. `rc=2` with `config_mismatch=1` means the tests passed but the config did not return to the expected fixture; the run printed the config differences. `leftover=<n>` above 0 means a Compose project outlived the run.
   - `<dir>/playwright.json`: Playwright's JSON report. Find the test whose status is `failed` or `timedOut` and read its error message and the location in the spec.
   - `<dir>/gateway.log`: the gateway's log from the failed run.
   - The failure screenshot, trace, and error context under `e2e/.last/pw-results/agw-e2e-<id with / as ->/`. Open the PNG with a file-reading tool that renders images, so you see it.
   - The lab markdown for the step the failing test performs.

   Then record the failure:

   ```bash
   e2e/lib/session-log.sh add failure <id> "<one-line explanation>"
   ```

2. Explain in plain language, by `skills/stop-slop/SKILL.md`, what the UI did against what the lab expected: the page and control the test was on, what the screenshot shows, the error the gateway logged, and the most likely cause. A missing or rejected key, a provider outage, or a rate limit at the provider are common causes outside the lab. If the cause is a product question, you may ask `solo-knowledge` a generic question, following `skills/ask-the-docs/SKILL.md`. Never paste log lines, config, or screenshot text into that query.
3. Offer exactly these options:

   - Retry the lab
   - Skip it and continue
   - Stop the session

   In adapt mode, `skills/adapt-lab/SKILL.md` replaces these with its own choices.

   In contribute mode, the id is `<track>/<slug>` and the choices are:

   - Retry step 5 as written: `e2e/lib/session-log.sh add decision <track>/<slug> retry`, then `e2e/run-e2e.sh <track>/<slug> --update-screenshots`.
   - Stop and go to step 8 (undo) in `skills/contribute-lab/SKILL.md`: `e2e/lib/session-log.sh add decision <track>/<slug> stop`.

   There is no skip in contribute mode. Do not run the plain retry command from "What each choice does" below, because it would not regenerate the screenshots.
4. Run nothing until the user picks.
5. The harness removed the throwaway gateway when the run ended. Confirm that the run printed no `LEFTOVER PROJECT:` line. If it printed one, name the project and offer `docker compose -p <name> down -v`.

## What each choice does

Retry: record it, then run the spec again.

```bash
e2e/lib/session-log.sh add decision <id> retry
e2e/run-e2e.sh <id>
```

Skip: record it, then continue with the next lab.

```bash
e2e/lib/session-log.sh add decision <id> skip
```

Stop: run nothing further, then record it:

```bash
e2e/lib/session-log.sh add decision <id> stop
```

Then go to the report step in `skills/evaluate/SKILL.md`.

Never edit the shipped lab under `labs/` or the shipped spec under `e2e/labs/`, and never change the user's gateway or `setup/` to make a run pass.
