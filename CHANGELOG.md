# Changelog

0.0.3 - (10-19-26)
---
- Add LLM track labs:
  - `connect-amazon-bedrock`: a `bedrock/*` model with Ambient AWS credentials from `setup/.env`, region `us-west-2` and the Prefer Runtime endpoint (the default Prefer Mantle returns 404 for `us.` inference profile IDs); Claude Haiku 4.5 in the Chat Playground and Logs, Claude Sonnet 4.6 by curl; optional `apiKey: $BEDROCK_API_KEY` added in Raw Configuration
  - `timeouts-and-retries`: a 2s `requestTimeout` LLM policy against a slow mock (504 in the Chat Playground and Logs), then a `public` gateway on port `8080` with a `flaky-llm` traffic route and a Retry policy (5 attempts, 100ms backoff, code 503)
  - `load-balancing-and-failover`: a Failover virtual model with `mock-llm` and `mock-llm-503` in the first group and an `openai-backup` model in group 2; the gateway drops the failing mock, stays in group 1, and moves to OpenAI when `mock-llm` is stopped
- Add LLM track lab `opa-authorization`: OPA as the External authz service with request body included; a Rego policy verifies the JWT, lets `platform` use any model and limits `marketing` to `openai/gpt-4o-mini`; the Chat Playground's Raw API key carries the token; read OPA's decision log; edit `setup/opa/policy.rego` and OPA reloads it
- Add MCP track labs:
  - `mcp-external-authorization`: MCP External authz with the `ext-authz-jwt` helper, which allows only tokens with `team: platform`; no token and bob are denied in the Tool Playground, alice connects
  - `mcp-oauth-keycloak`: MCP authentication with Keycloak's JWKS URL and issuer; MCP Inspector discovers Keycloak from the gateway's metadata, registers itself, signs alice in, and calls a tool
  - `obo-token-exchange`: a `public` gateway on port `8080` with a route to `procurement-api`; a `backendAuth.oauthTokenExchange` policy exchanges alice's token at Keycloak for one with the audience `procurement-api`; Part B switches to delegation with `actorToken` from an `x-actor-token` header, so the API's token keeps alice as `sub` and names `procurement-agent` in `act`, and checks a missing actor (400) and an actor alice did not name in `may_act` (Keycloak 403)
  - `mcp-guardrails`: procurement MCP server behind MCP authentication, an ExtMCP authorization processor (fail closed: tool lists and calls per persona, purchase order limits, email domain allowlist) and a masking processor (fail open: bank account and tax ID); stop each policy server to compare failure modes, and lower a limit by editing `setup/extmcp/authz.yaml`
- Add helper profile `opa` (`openpolicyagent/opa:1.21.0-envoy-static`, with `setup/opa/` holding `config.yaml`, `policy.rego` and the workshop JWKS as `data.json`)
- Add helper profiles `ext-authz-jwt` and `mcp-guardrails` (`procurement-mcp`, `extmcp-authz`, `extmcp-redact`), with policy files in `setup/extmcp/`
- Add helper profile `mock-llm-faults`: `mock-llm-slow` (5s to first token), `mock-llm-flaky` (30% 503) and `mock-llm-503` (every request 503)
- Add helper profiles `mcp-inspector` (MCP Inspector 2.9.0 in the gateway's network, on port `6274`) and `obo` (`procurement-api`, an echo service that decodes the JWT it receives)
- Keycloak `workshop` realm: anonymous client registration from `localhost`, `127.0.0.1` and `github.com` (Trusted Hosts), and clients `workshop-cli`, `agentgateway` (standard token exchange) and `procurement-api` for token exchange, plus `agent-cli` (fixed `may_act` claim naming `procurement-agent`) and `procurement-agent` (delegation actor, service account user with a fixed ID) for delegation
- Keycloak 26.4.0 to 26.8.1
- Add `lib/jwt/tokens/requester.jwt`, `buyer.jwt` and `finance-approver.jwt` with a `persona` claim; `make-tokens.sh` mints them

0.0.2 - (10-19-26)
---
- Restore setup/config.yaml to the starting config

0.0.1 - (10-19-26)
---
- Add Platform track:
  - `ui-access-control`: serve the UI on the `public` gateway (port `8080`) with a Basic auth policy, map `basicAuth.username` to the user with `config.standardAttributes.user`, and add `admin`, `viewer` and `self-service` roles for alice, bob and carol; carol sees only her own virtual key
  - `ui-access-control-oidc`: OIDC sign-in with Keycloak, roles matched on the `groups` claim, and a custom `manage` grant on the `openai/*` model for `carol@example.com`
- Add `setup/ui-users.htpasswd`: UI users `alice`, `bob` and `carol` with the password `workshop`
- Add `keycloak` helper profile and `setup/keycloak/workshop-realm.json`: realm `workshop` with three users in three groups, the `agentgateway-ui` client and a `groups` claim mapper. Keycloak shares the gateway's network on port `8180`, so the browser and the gateway use the same issuer URL

0.0.0 - (10-16-26)
---
- Add `001-set-up-standalone-agentgateway.md`: start Enterprise agentgateway `2026.10.0` with Docker Compose and tour the UI
- Add `setup/`: Compose stack (ports `15000`, `4000`, `4001`, `8080` with matching host and container numbers), starting `config.yaml`, `.env.example`, model cost catalog, and helper profiles `mock-llm`, `mcp-everything`, `ext-authz`, `guardrail-webhook`
- Add `lib/jwt/`: workshop JWKS, `alice` and `bob` tokens with a `team` claim, and `make-tokens.sh`
- Add LLM track:
  - `connect-llm-providers`: OpenAI wildcard model, Chat Playground, Logs, Client Setup (foundation lab)
  - `virtual-api-keys`: API key auth, keys for alice and bob, 401 without a key, per-user Logs and Analytics
  - `jwt-auth-and-authorization`: JWT auth with an inline JWKS, authorization rule `jwt.team == "platform"`
  - `external-authorization`: gRPC External authz with the `ext-authz` helper
  - `local-rate-limiting`: token-based local rate limit, 429 on the second request
  - `budgets-and-cost-tracking`: custom gpt-4o-mini price, 10-token budget in Block mode, spend in Analytics
  - `builtin-guardrails`: built-in detector and custom regex request guards, email masking on responses
  - `moderation-guardrails`: OpenAI Moderation request guard, API key set in Raw Configuration
  - `webhook-guardrails`: request and response Webhook guards with the `guardrail-webhook` helper
  - `prompt-enrichment-and-transformations`: response headers and a gateway-side system prompt
  - `model-failover`: Failover virtual model across mock LLMs with a health policy on 429
  - `connect-coding-agents`: Codex and Claude Code through the gateway (Anthropic steps optional)
- Add MCP track:
  - `connect-remote-mcp-server`: enable MCP, add `search.solo.io`, Tool Playground (foundation lab)
  - `local-mcp-and-federation`: `mcp-everything` beside `solo-docs`, prefix mode, fail closed and fail open
  - `openapi-to-mcp`: Open-Meteo API as an MCP tool from an inline OpenAPI schema
  - `mcp-tool-modes`: Search and Code tool modes
  - `mcp-auth-and-tool-authorization`: MCP JWT authentication and a Deny rule on `mcp.tool.name` and `jwt.team`
  - `mcp-rate-limiting`: local rate limit of 5 requests per 300s on MCP traffic; the third tool call returns `rate limit exceeded`
- Add `e2e/`: `run-e2e.sh` runs each lab's Playwright spec against a throwaway gateway with no host ports, captures screenshots, and checks cleanup returns the config to the start fixture; `lint.sh` checks lab structure and links
- Add `README.md`, `style-guide.md`, and `.gitignore` (copied from the Kubernetes workshop, plus `!.env.example`, `e2e/.last/` and `setup/data.db*`)
