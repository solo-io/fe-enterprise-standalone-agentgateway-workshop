# Standalone Enterprise Agentgateway Workshop

Hands-on labs for Solo Enterprise for agentgateway in standalone mode: one Docker container that you configure by clicking through its built-in UI. Each lab shows the UI steps with screenshots, checks the result in the UI, and offers an optional curl check.

The labs cover the same features as the [Kubernetes workshop](https://github.com/solo-io/fe-enterprise-agentgateway-workshop), set up through the UI instead of YAML.

## Prerequisites

- **Solo Enterprise for agentgateway license key.** Ask your Solo.io contact for a trial key.
- **OpenAI API key.** The labs use `gpt-6-luna` to keep costs low.
- **Docker Desktop** (macOS, Windows with WSL) or Docker Engine with the Compose plugin (Linux).
- Optional: an **Anthropic API key**, for [Connect Anthropic Next to OpenAI](labs/llm/connect-anthropic.md) and the Claude Code steps in [Connect Coding Agents](labs/llm/connect-coding-agents.md).
- Optional: **AWS credentials** with Amazon Bedrock access, for [Connect Amazon Bedrock](labs/llm/connect-amazon-bedrock.md).
- Optional: a **TypeSafe API key**, for the two Jev labs. The [OpenAI Decisions API](labs/llm/semantic-routing-openai-decisions.md) lab needs an OpenAI key with access to `/v1/decisions`.

The labs use gateway image `agentgateway-enterprise:2026.10.0` and ports `15000`, `4000`, `4001`, `8080`, `8443`, `8180` and `6274` on your computer, plus `3000` (Grafana) and `9090` (Prometheus) in the metrics lab.

## Start here

- [001: Set Up Standalone Agentgateway](001-set-up-standalone-agentgateway.md)

Then do the first lab of the LLM track. Every other lab, including the MCP track, builds on it.

## LLM track

Start with:

- [Connect LLM Providers](labs/llm/connect-llm-providers.md): add an OpenAI model, chat in the Chat Playground, find the request in Logs.

Then do any of these, in any order. Each lab cleans up after itself.

| Lab | What you do | Helper service |
|---|---|---|
| [Stream Replies and Create Embeddings](labs/llm/streaming-and-embeddings.md) | Stream a chat reply, turn a sentence into an embedding, find both in Logs with their tokens and cost | |
| [Connect Anthropic Next to OpenAI](labs/llm/connect-anthropic.md) | Add Anthropic as a shared provider and an `anthropic/*` model, ask GPT and Claude the same question, call Claude in OpenAI and Anthropic format, compare providers in Logs and Analytics | |
| [Connect Amazon Bedrock](labs/llm/connect-amazon-bedrock.md) | Add a Bedrock model that signs requests with your AWS credentials, chat with Claude Haiku, optionally switch to a Bedrock API key | |
| [Give Each User a Virtual API Key](labs/llm/virtual-api-keys.md) | Issue per-user keys, block requests without a key, see usage per user in Logs and Analytics | |
| [Require a JWT and Allow Only One Team](labs/llm/jwt-auth-and-authorization.md) | Require a JWT, then allow only callers whose `team` claim is `platform` | |
| [Let Your Own Service Approve Each Request](labs/llm/external-authorization.md) | Send each request to an external authorization service that allows or denies it | `ext-authz` |
| [Decide Who Can Use Which Model with Open Policy Agent](labs/llm/opa-authorization.md) | Send each request to OPA, allow one team any model and limit another to one model, change the Rego policy live | `opa` |
| [Limit LLM Tokens with a Local Rate Limit](labs/llm/local-rate-limiting.md) | Cap tokens per minute and see the 429 | |
| [Track LLM Cost and Enforce a Budget](labs/llm/budgets-and-cost-tracking.md) | Set a model price, block requests over a token budget, see spend in Analytics | |
| [Block and Mask Sensitive Data with Built-in Guardrails](labs/llm/builtin-guardrails.md) | Block credit cards, SSNs and AWS keys in prompts, mask email addresses in replies | |
| [Block Harmful Prompts with OpenAI Moderation](labs/llm/moderation-guardrails.md) | Reject violent or hateful prompts before they reach the model | |
| [Check Prompts and Replies with a Guardrail Webhook](labs/llm/webhook-guardrails.md) | Send prompts and replies to an LLM-based webhook that rejects jailbreaks and masks personal data | `guardrail-webhook` |
| [Judge Prompts and Mask Personal Data with a Jev Guardrail Webhook](labs/llm/webhook-guardrails-jev.md) | Score each prompt against rules with Jev, mask personal values but keep a company's published contact, add a rule in one file | `guardrail-jev` |
| [Enrich Prompts and Transform Responses](labs/llm/prompt-enrichment-and-transformations.md) | Add a gateway-side system prompt and add response headers | |
| [Fail Over Between Models](labs/llm/model-failover.md) | Move traffic off a rate-limited backend with a Failover virtual model | `mock-llm` |
| [Stop Slow Requests and Retry Failed Ones](labs/llm/timeouts-and-retries.md) | End slow LLM requests with a 2 second timeout, then retry `503` errors on a traffic route | `mock-llm-faults` |
| [Load Balance Models and Fail Over to a Backup](labs/llm/load-balancing-and-failover.md) | Spread requests across two models in one group, drop the failing one, and fail over to OpenAI when the group is down | `mock-llm`, `mock-llm-faults` |
| [Route Requests by Path, Header, and Query Parameter](labs/llm/routing-match-types.md) | Send requests to two model servers by URL path, header or query parameter on a traffic gateway | `mock-llm-routing` |
| [Route Requests by a Field in the Request Body](labs/llm/body-based-routing.md) | Send requests tagged `metadata.app: support` to a smaller model with a Conditional virtual model | `mock-llm-routing` |
| [Route Each Prompt to the Cheapest Model That Can Answer It, with Jev](labs/llm/semantic-routing-jev.md) | Give clients one model name, `auto_model`, and let Jev pick one of three price tiers for each prompt | `semantic-router-jev` |
| [Route Each Prompt to the Cheapest Model That Can Answer It, with the OpenAI Decisions API](labs/llm/semantic-routing-openai-decisions.md) | The same router, with OpenAI's Decisions API as the classifier | `semantic-router-openai` |
| [Connect Coding Agents](labs/llm/connect-coding-agents.md) | Point Codex and Claude Code at the gateway with Client Setup (Claude Code needs the model from Connect Anthropic Next to OpenAI) | |

## MCP track

Start with (after [Connect LLM Providers](labs/llm/connect-llm-providers.md)):

- [Connect a Remote MCP Server](labs/mcp/connect-remote-mcp-server.md): turn on MCP, add the Solo.io docs server, call a tool in the Tool Playground.

Then do any of these, in any order:

| Lab | What you do | Helper service |
|---|---|---|
| [Federate a Local MCP Server with a Remote One](labs/mcp/local-mcp-and-federation.md) | Serve tools from two servers in one session, control tool name prefixes, compare fail closed with fail open | `mcp-everything` |
| [Turn a REST API into MCP Tools with OpenAPI](labs/mcp/openapi-to-mcp.md) | Expose the Open-Meteo weather API as an MCP tool from an OpenAPI schema | |
| [Turn Your Own REST API into MCP Tools with OpenAPI](labs/mcp/openapi-to-mcp-local-service.md) | Expose three operations of a local API as MCP tools, including a path parameter, and have the gateway add the API key | `stripe-mock` |
| [Shrink the Tool List with Search and Code Tool Modes](labs/mcp/mcp-tool-modes.md) | Replace the tool list with `get_tool`/`invoke_tool`, then with a single `run_code` tool | |
| [Require a Token for MCP and Limit Tools by Team](labs/mcp/mcp-auth-and-tool-authorization.md) | Require a JWT for MCP, then hide a tool from one team | |
| [Rate Limit MCP Traffic](labs/mcp/mcp-rate-limiting.md) | Limit MCP requests and see the rate limit error on a tool call | |
| [Sign In to MCP with Keycloak](labs/mcp/mcp-oauth-keycloak.md) | Require a Keycloak token for MCP, then sign in from MCP Inspector and follow the OAuth steps | `keycloak`, `mcp-inspector` |
| [Call an API on the User's Behalf with Token Exchange](labs/mcp/obo-token-exchange.md) | Have the gateway exchange the user's Keycloak token for one issued to the API it calls | `keycloak`, `obo` |
| [Let Your Own Service Approve Each MCP Request](labs/mcp/mcp-external-authorization.md) | Send each MCP request to an external authorization service that allows only the `platform` team | `ext-authz-jwt` |
| [Decide Who Can Call Which MCP Tool with Open Policy Agent](labs/mcp/mcp-opa-authorization.md) | Use the OPA service from the LLM track to deny one team a tool by reading the JSON-RPC body | `opa` |
| [Guard MCP Tool Calls with a Policy Server](labs/mcp/mcp-guardrails.md) | Scope tools per persona, deny purchase orders over a limit, block outside email, mask bank details, compare fail closed with fail open | `mcp-guardrails` |

## Platform track

These labs start after [Connect LLM Providers](labs/llm/connect-llm-providers.md). The two UI access labs set up the same roles: the first with passwords, the second with an identity provider. Do either one, or both.

| Lab | What you do | Helper service |
|---|---|---|
| [Give Each Person the Right Access to the UI](labs/platform/ui-access-control.md) | Require a password on the UI, then give alice full access, bob read-only access and carol only her own API keys | |
| [Sign In to the UI with Keycloak and Map Groups to Roles](labs/platform/ui-access-control-oidc.md) | Sign users in through Keycloak, give each Keycloak group a role, and let one user manage one model | `keycloak` |
| [Serve Traffic over HTTPS and Require Client Certificates](labs/platform/tls-termination.md) | Make an HTTPS gateway on port `8443` with the workshop certificates, then require a client certificate (mTLS) | `mock-llm` |
| [Serve Several Hostnames with Their Own Certificates](labs/platform/sni-matching.md) | Serve `foo.example.com` and `bar.example.com` on one port, each with its own certificate (SNI) | `mock-llm` |
| [See Gateway Metrics, Traces, and Alerts in Grafana](labs/platform/metrics-and-tracing.md) | Scrape the gateway with Prometheus, read the agentgateway dashboard, open a trace with model and token counts, fire an error-rate alert | `observability`, `mock-llm-faults` |

## Helper services

Some labs need a small service next to the gateway, such as a mock LLM or an MCP server. The lab tells you to start it from the `setup` folder:

```bash
env UID=$(id -u) GID=$(id -g) docker compose --profile <helper> up -d
```

## For workshop authors

- [style-guide.md](style-guide.md): how labs are written
- [e2e/README.md](e2e/README.md): every lab has a Playwright spec that runs it end to end and captures its screenshots
