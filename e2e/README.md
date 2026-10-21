# Lab validation

Each lab has a spec in `labs/` that performs the lab through the UI, checks every result, captures the lab's screenshots, and runs the cleanup steps. A lab ships only when its spec passes.

## Run

You need Docker and `setup/.env` with real keys. Each run first checks the keys against their providers. A missing or rejected Anthropic, TypeSafe or AWS key makes the tests that need it skip, with a line saying why; a rejected OpenAI key stops the run.

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

The final config of each run is saved to `e2e/.last/<lab>.yaml`. Failure screenshots and Playwright error context go to `e2e/.last/pw-results/<compose project>/`.

## Fixtures

Every lab starts from and returns to `base`, which is `setup/config.yaml` itself (the state after `001`). Other fixtures, if a spec needs one, go in `e2e/fixtures/<name>.yaml`. `e2e/lib/setup.ts` has the shared **Set up** and cleanup steps: add and delete the `openai/*` model, turn on MCP, add an MCP server, apply the Tool Playground CORS policy, turn off MCP.
