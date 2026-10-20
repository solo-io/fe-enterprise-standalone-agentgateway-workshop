# Standalone Enterprise Agentgateway Workshop

Hands-on labs for Solo Enterprise for agentgateway in standalone mode: one Docker container that you configure by clicking through its built-in UI. Each lab shows the UI steps with screenshots, checks the result in the UI, and offers an optional curl check.

The labs cover the same features as the [Kubernetes workshop](https://github.com/solo-io/fe-enterprise-agentgateway-workshop), set up through the UI instead of YAML.

## Prerequisites

- **Solo Enterprise for agentgateway license key.** Ask your Solo.io contact for a trial key.
- **OpenAI API key.** The labs use `gpt-6-luna` to keep costs low.
- **Docker Desktop** (macOS, Windows with WSL) or Docker Engine with the Compose plugin (Linux).

A few labs need another API key or AWS credentials. The **Needs** column in each lab table lists them, with the helper services.

The labs use gateway image `agentgateway-enterprise:2026.10.0` and ports `15000`, `4000`, `4001`, `8080`, `8443`, `8180` and `6274` on your computer, plus `3000` (Grafana) and `9090` (Prometheus) in the metrics lab.

## Start here

1. [Set Up Standalone Agentgateway](001-set-up-standalone-agentgateway.md)
2. [Connect LLM Providers](labs/llm/connect-llm-providers.md): add an OpenAI model, chat in the Chat Playground, find the request in Logs. Every lab except Connect Anthropic builds on it.
3. Pick labs from any track, in any order. Each lab cleans up after itself.

| Track | Topics |
|---|---|
| [LLM](#llm-track) | [Providers and clients](#providers-and-clients) · [Access control](#model-access-control) · [Cost and limits](#cost-and-limits) · [Guardrails](#guardrails) · [Request processing](#request-processing) · [Routing and resilience](#routing-and-resilience) |
| [MCP](#mcp-track) | Start with [Connect a Remote MCP Server](labs/mcp/connect-remote-mcp-server.md), then [Servers and tools](#mcp-servers-and-tools) · [Access control](#mcp-access-control) · [Limits and guardrails](#mcp-limits-and-guardrails) |
| [Platform](#platform-track) | UI access · TLS · Metrics and tracing |

## LLM track

### Providers and clients

| Lab | What you do | Needs |
|---|---|---|
| [Anthropic](labs/llm/connect-anthropic.md) | Add Anthropic as a shared provider and an `anthropic/*` model, call Claude in OpenAI and Anthropic format, find tokens and cost in Logs and Analytics, optionally compare with GPT. Needs only 001 | Anthropic key |
| [Amazon Bedrock](labs/llm/connect-amazon-bedrock.md) | Add a Bedrock model that signs requests with your AWS credentials, chat with Claude Haiku, optionally switch to a Bedrock API key | AWS credentials with Bedrock access |
| [Coding Agents](labs/llm/connect-coding-agents.md) | Point Codex and Claude Code at the gateway with Client Setup | For Claude Code: Anthropic key and the model from Connect Anthropic |
| [Streaming and Embeddings](labs/llm/streaming-and-embeddings.md) | Stream a chat reply, turn a sentence into an embedding, find both in Logs with their tokens and cost | |

### Model access control

| Lab | What you do | Needs |
|---|---|---|
| [Virtual API Keys](labs/llm/virtual-api-keys.md) | Issue per-user keys, block requests without a key, see usage per user in Logs and Analytics | |
| [JWT Auth and Team Authorization](labs/llm/jwt-auth-and-authorization.md) | Require a JWT, then allow only callers whose `team` claim is `platform` | |
| [External Authorization](labs/llm/external-authorization.md) | Send each request to an external authorization service that allows or denies it | `ext-authz` |
| [Open Policy Agent](labs/llm/opa-authorization.md) | Send each request to OPA, allow one team any model and limit another to one model, change the Rego policy live | `opa` |

### Cost and limits

| Lab | What you do | Needs |
|---|---|---|
| [Token Rate Limit](labs/llm/local-rate-limiting.md) | Cap tokens per minute and see the 429 | |
| [Cost Tracking and Budgets](labs/llm/budgets-and-cost-tracking.md) | Set a model price, block requests over a token budget, see spend in Analytics | |

### Guardrails

| Lab | What you do | Needs |
|---|---|---|
| [Built-in Guardrails](labs/llm/builtin-guardrails.md) | Block credit cards, SSNs and AWS keys in prompts, mask email addresses in replies | |
| [OpenAI Moderation](labs/llm/moderation-guardrails.md) | Reject violent or hateful prompts before they reach the model | |
| [Guardrail Webhook](labs/llm/webhook-guardrails.md) | Send prompts and replies to an LLM-based webhook that rejects jailbreaks and masks personal data | `guardrail-webhook` |
| [Guardrail Webhook with Jev](labs/llm/webhook-guardrails-jev.md) | Score each prompt against rules with Jev, mask personal values but keep a company's published contact, add a rule in one file | `guardrail-jev`, TypeSafe key |

### Request processing

| Lab | What you do | Needs |
|---|---|---|
| [Prompt Enrichment and Transformations](labs/llm/prompt-enrichment-and-transformations.md) | Add a gateway-side system prompt and add response headers | |

### Routing and resilience

| Lab | What you do | Needs |
|---|---|---|
| [Path, Header and Query Routing](labs/llm/routing-match-types.md) | Send requests to two model servers by URL path, header or query parameter on a traffic gateway | `mock-llm-routing` |
| [Timeouts and Retries](labs/llm/timeouts-and-retries.md) | End slow LLM requests with a 2 second timeout, then retry `503` errors on a traffic route | `mock-llm-faults` |
| [Model Failover](labs/llm/model-failover.md) | Move traffic off a rate-limited backend with a Failover virtual model | `mock-llm` |
| [Load Balancing and Failover](labs/llm/load-balancing-and-failover.md) | Spread requests across two models in one group, drop the failing one, and fail over to OpenAI when the group is down | `mock-llm`, `mock-llm-faults` |
| [Semantic Routing with OpenAI Decisions](labs/llm/semantic-routing-openai-decisions.md) | Give clients one model name, `auto_model`, and let the OpenAI Decisions API pick the cheapest of three price tiers that can answer each prompt | `semantic-router-openai`, OpenAI key with access to `/v1/decisions` |
| [Semantic Routing with Jev](labs/llm/semantic-routing-jev.md) | The same router, with Jev as the classifier | `semantic-router-jev`, TypeSafe key |
| [Body-Based Routing](labs/llm/body-based-routing.md) | Send requests tagged `metadata.app: support` to a smaller model with a Conditional virtual model | `mock-llm-routing` |

## MCP track

Start with [Connect a Remote MCP Server](labs/mcp/connect-remote-mcp-server.md): turn on MCP, add the Solo.io docs server, call a tool in the Tool Playground. The other MCP labs build on it.

### MCP servers and tools

| Lab | What you do | Needs |
|---|---|---|
| [Local MCP and Federation](labs/mcp/local-mcp-and-federation.md) | Serve tools from two servers in one session, control tool name prefixes, compare fail closed with fail open | `mcp-everything` |
| [OpenAPI to MCP](labs/mcp/openapi-to-mcp.md) | Expose the Open-Meteo weather API as an MCP tool from an OpenAPI schema | |
| [OpenAPI to MCP for a Local API](labs/mcp/openapi-to-mcp-local-service.md) | Expose three operations of a local API as MCP tools, including a path parameter, and have the gateway add the API key | `stripe-mock` |
| [Search and Code Tool Modes](labs/mcp/mcp-tool-modes.md) | Replace the tool list with `get_tool`/`invoke_tool`, then with a single `run_code` tool | |

### MCP access control

| Lab | What you do | Needs |
|---|---|---|
| [MCP JWT Auth and Tool Authorization](labs/mcp/mcp-auth-and-tool-authorization.md) | Require a JWT for MCP, then hide a tool from one team | |
| [MCP Sign-In with Keycloak](labs/mcp/mcp-oauth-keycloak.md) | Require a Keycloak token for MCP, then sign in from MCP Inspector and follow the OAuth steps | `keycloak`, `mcp-inspector` |
| [Token Exchange (On Behalf Of)](labs/mcp/obo-token-exchange.md) | Have the gateway exchange the user's Keycloak token for one issued to the API it calls | `keycloak`, `obo` |
| [MCP External Authorization](labs/mcp/mcp-external-authorization.md) | Send each MCP request to an external authorization service that allows only the `platform` team | `ext-authz-jwt` |
| [MCP Open Policy Agent](labs/mcp/mcp-opa-authorization.md) | Use the OPA service from the LLM track to deny one team a tool by reading the JSON-RPC body | `opa` |

### MCP limits and guardrails

| Lab | What you do | Needs |
|---|---|---|
| [MCP Rate Limit](labs/mcp/mcp-rate-limiting.md) | Limit MCP requests and see the rate limit error on a tool call | |
| [MCP Policy Server Guardrails](labs/mcp/mcp-guardrails.md) | Scope tools per persona, deny purchase orders over a limit, block outside email, mask bank details, compare fail closed with fail open | `mcp-guardrails` |

## Platform track

The two UI access labs set up the same roles: the first with passwords, the second with an identity provider. Do either one, or both.

| Lab | What you do | Needs |
|---|---|---|
| [UI Access Control](labs/platform/ui-access-control.md) | Require a password on the UI, then give alice full access, bob read-only access and carol only her own API keys | |
| [UI Sign-In with Keycloak](labs/platform/ui-access-control-oidc.md) | Sign users in through Keycloak, give each Keycloak group a role, and let one user manage one model | `keycloak` |
| [TLS Termination and mTLS](labs/platform/tls-termination.md) | Make an HTTPS gateway on port `8443` with the workshop certificates, then require a client certificate (mTLS) | `mock-llm` |
| [SNI Matching](labs/platform/sni-matching.md) | Serve `foo.example.com` and `bar.example.com` on one port, each with its own certificate (SNI) | `mock-llm` |
| [Metrics, Traces and Alerts](labs/platform/metrics-and-tracing.md) | Scrape the gateway with Prometheus, read the agentgateway dashboard, open a trace with model and token counts, fire an error-rate alert | `observability`, `mock-llm-faults` |

## Helper services

Some labs need a small service next to the gateway, such as a mock LLM or an MCP server. In the **Needs** column, these are the names in code format. The lab tells you to start it from the `setup` folder:

```bash
env UID=$(id -u) GID=$(id -g) docker compose --profile <helper> up -d
```

## For workshop authors

- [style-guide.md](style-guide.md): how labs are written
- [e2e/README.md](e2e/README.md): every lab has a Playwright spec that runs it end to end and captures its screenshots
