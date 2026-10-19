# Changelog

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
