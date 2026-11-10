---
name: ask-the-docs
description: Query the Solo knowledge-base MCP server (solo-knowledge) for product questions without sending anything about the user's gateway. Use for product, configuration, or version questions during a session.
---

# Ask the docs

`solo-knowledge` is an HTTP MCP server run by Solo. Whatever you send is a query to a third party, so it carries product concepts only.

## Tool order

1. `search_use_cases`, then `get_use_case` on the best hit's `filename`. Name the product `agentgateway` and say standalone mode when it matters.
2. `get_feature_history` before you state which version added or removed something.
3. `get_changelog` for what changed in a version.

The UI writes the gateway's `config.yaml`; the source labs' "What the UI wrote" sections show the keys. Prefer those over a schema lookup when you describe what a lab writes.

## The leak rule

`solo-knowledge` is the only service you query for product information. Do not use web search, web fetch, or any other MCP server, even if the harness offers them. `.claude/settings.json` denies web search and web fetch in Claude Code. The Playwright MCP server runs in a local container and is used only in adapt's learning phase.

No config, logs, screenshots, report content, or `custom-labs/` content goes into a query. Before you send one, check that it contains none of these:

- IP addresses
- hostnames and URLs other than `localhost`
- the user's company, team, cloud account, project, subscription, or ARN identifiers
- names the user chose: model aliases, virtual key names, team names, MCP server names, route names
- API keys, tokens, JWTs, and license keys
- any text copied from command output, gateway logs, Playwright errors, or screenshots

If it does, rewrite it to the generic form. Examples:

- Instead of "why does key `acme-payments` get 401 on model `acme/gpt` at 10.4.2.17", ask "when does agentgateway return 401 for a request that carries a virtual API key".
- Instead of "my MCP rate limit on server `acme-tools` returns isError after 5 calls", ask "how does an MCP rate limit report a denied tools/call in agentgateway".

## Record it

Log each question and its answer, in the generic form you sent:

```bash
e2e/lib/session-log.sh add question - "<the query you sent>"
e2e/lib/session-log.sh add answer - "<one-line summary of the answer>"
```

Use the lab id, or `custom/<name>`, instead of `-` when the question came from a lab.
