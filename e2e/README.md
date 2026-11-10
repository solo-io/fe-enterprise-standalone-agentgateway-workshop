# Lab validation

Each lab has a spec in `labs/` that performs the lab through the UI, checks every result, captures the lab's screenshots, and runs the cleanup steps. A lab ships only when its spec passes.

## Run

You need Docker and `setup/.env` with real keys. Each run first checks the keys against their providers. A missing or rejected Anthropic, TypeSafe or AWS key makes the tests that need it skip, with a line saying why; a rejected OpenAI key stops the run. A result with a working OpenAI key is reused for 10 minutes (`e2e/.work/keys.cache`, which holds no key value) unless a key or `setup/.env` changes; `E2E_KEYS_TTL=<seconds>` sets the time and `E2E_KEYS_TTL=0` checks every run.

```bash
e2e/run-e2e.sh 001                                  # one lab
e2e/run-e2e.sh llm/virtual-api-keys --update-screenshots
e2e/run-e2e.sh all                                  # every lab
e2e/lint.sh                                         # markdown checks
```

## How a run works

1. Copies `setup/` to a temp folder and replaces `config.yaml` with the spec's start fixture (`// @fixture`, default `base`).
2. Starts the Compose project `agw-e2e-<lab>` with the helper profiles from `// @profiles`. `compose.e2e.yaml` removes the host ports, so runs do not clash with a gateway already on port 15000 and can run in parallel.
3. Runs Playwright in `mcr.microsoft.com/playwright:v1.64.1-noble` inside the gateway's network namespace. Specs use `http://localhost:15000/ui` and the real gateway ports.
4. Compares the final `config.yaml` with the expected fixture (`// @expect`, default: the start fixture). UI metadata is ignored and empty values count as absent, except a top-level key left empty (such as `gateways: {}`), which fails: the lab's Clean up must delete it. A mismatch exits with code 2.
5. Removes the Compose project and the temp folder.

A spec that restarts the gateway, such as `platform/postgres-backend`, sets `// @restarts gateway`. The run then adds `compose.e2e-restart.yaml`: a pause container holds the network namespace and the gateways join it, so Playwright keeps its network when the gateway container restarts.

The final config of each run is saved to `e2e/.last/<lab>.yaml`. Failure screenshots and Playwright error context go to `e2e/.last/pw-results/<compose project>/`.

`--skip <id>` (repeatable) records a lab as `SKIP (declined)` without running it, for example `e2e/run-e2e.sh --track llm --skip llm/connect-anthropic`. An id the run does not cover exits 64.

## Learning gateway

Adapt mode learns a new UI flow on a throwaway gateway, never on yours. `e2e/lib/playwright-mcp.sh` runs the Playwright MCP server in that gateway's network namespace.

```bash
e2e/run-e2e.sh --learn <name> --profiles <p1,p2>   # start agw-e2e-learn from base; ends with LEARN READY agw-e2e-learn
e2e/run-e2e.sh --learn <name> --diff               # config changes since start: exit 0 none, 2 some, 1 error
e2e/run-e2e.sh --learn <name> --restart            # restart the gateway; the netns container stays
e2e/run-e2e.sh --learn <name> --stop               # save config.after.yaml and remove the project
```

The project uses the restart override, so its namespace container is `agw-e2e-learn-netns-1`. Files go to `e2e/.work/adapt/<name>/`. A spec run never counts `agw-e2e-learn` as its own leftover; `detect-env.sh` still lists it.

## Fixtures

Every lab starts from and returns to `base`, which is `setup/config.yaml` itself (the state after `001`). Other fixtures, if a spec needs one, go in `e2e/fixtures/<name>.yaml`. `e2e/lib/setup.ts` has the shared **Set up** and cleanup steps: add and delete the `openai/*` model, turn on MCP, add an MCP server, apply the Tool Playground CORS policy, turn off MCP.
