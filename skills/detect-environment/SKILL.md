---
name: detect-environment
description: Check Docker, Compose, the keys, the Playwright images, leftover projects, and setup/config.yaml before a session. Use at the start of evaluate, adapt, and contribute.
---

# Detect the environment

Run from the repo root:

```bash
e2e/lib/detect-env.sh
```

It prints one `key: value` line per field and writes `e2e/.work/env.json`. Read that file and tell the user what it found.

## Exit codes

- 0: the session can run. Summarize the fields below in a few sentences.
- 2: the session must stop. Show the lines it printed; each names a missing item: Docker, the Compose plugin, `python3`, `jq`, `setup/.env`, or a working `OPENAI_API_KEY`. Ask the user to fix it and start again. Do not continue until a re-run exits 0.
- Any other exit: detection hit an error. Show it and stop.

## Fields

- `docker`, `compose`: the Docker server and Compose plugin versions, or `absent`.
- `playwright_image`: `pull needed` means the first spec run pulls the Playwright image, which takes a few minutes. Say so.
- `playwright_mcp_image`: the image for adapt's learning phase. `pull needed` means the learning phase pulls it first. Only adapt needs it.
- `env_file`: whether `setup/.env` exists.
- `keys`: each key as `ok`, `missing`, or `rejected`. A key that is `missing` or `rejected` makes the tests that need it skip.
- `user_gateway`: the user's own gateway on port `15000`, `running` with its version or `absent`. Informational. No mode uses or changes it.
- `ports`: `fail` means `e2e/check-ports.sh` found a lab that uses a port the Compose file does not publish. Tell the user; it is a repo bug, not theirs.
- `leftover_projects`: `agw-e2e-*` Compose projects that exist now. If it lists any, name each one and offer to remove it. On a yes, for each name:

  ```bash
  docker compose -p <name> down -v
  ```

  Remove nothing outside the `agw-e2e-` prefix. `agw-e2e-learn` is a learning gateway that an earlier adapt session did not stop; remove it with `e2e/run-e2e.sh --learn <name> --stop` when you know the lab name, else as above.
- `setup_config_dirty`: `true` means `setup/config.yaml` differs from git `HEAD`. The harness uses the working-tree file as the `base` fixture, and the user's own gateway writes to that file on every click, so every throwaway run would start from and be checked against the wrong state. Stop and tell the user why. They can see the change with `git diff -- setup/config.yaml`. Restoring the file is their decision and their command; never restore it yourself. Continue only when they have restored it and a re-run reports `setup_config_dirty: false`, or they say the change is intended. Log the answer:

  ```bash
  e2e/lib/session-log.sh add decision - "setup/config.yaml differs from HEAD: <restored|intended>"
  ```

- `setup_config_dirty_error`: set when the check could not read git. Show it and stop.
- `node`: the Node version, used by `node e2e/lib/report.mjs compare`.
- `python3`, `jq`: versions, or `absent`.
- `gh`: the `gh` version, or `absent`. Only contribute needs it.
- `detected_at`: when detection ran.
