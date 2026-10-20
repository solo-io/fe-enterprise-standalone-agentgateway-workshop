# Decide Who Can Call Which MCP Tool with Open Policy Agent

## Before you start

- Complete [Connect a Remote MCP Server](connect-remote-mcp-server.md). The gateway serves the `solo-docs` MCP server on port `4001`.
- Start Open Policy Agent (OPA) with the workshop policy. From the `setup/` folder, run:

  ```bash
  env UID=$(id -u) GID=$(id -g) docker compose --profile opa up -d
  ```

  This starts the `opa` container next to the gateway. It listens for gRPC on port `9000` and reads its policy from `setup/opa/`. It is the same OPA service that [Decide Who Can Use Which Model with Open Policy Agent](../llm/opa-authorization.md) uses for LLM requests.

## What you'll do

- Point the MCP gateway at OPA with the External authz policy
- Send the request body to OPA, so the policy can see which tool a client calls
- See the Tool Playground denied without a token
- See bob denied the `get_full_page` tool and allowed the `search` tool
- See alice call `get_full_page`
- Read OPA's decision log

## Why this matters

One OPA service can protect your LLM traffic and your MCP traffic with the same rules file. The gateway asks OPA about every MCP request before the request reaches an MCP server. MCP clients send each tool call as a JSON-RPC message in the request body, so when the gateway includes the body, OPA can allow or deny single tools.

The policy in `setup/opa/policy.rego` checks the token in the `Authorization` header against the workshop's public key, then reads the `team` claim:

| Token | `sub` | `team` | MCP tools |
|---|---|---|---|
| `lib/jwt/tokens/alice.jwt` | `alice` | `platform` | all |
| `lib/jwt/tokens/bob.jwt` | `bob` | `marketing` | all except `get_full_page` |

The rule that lets the `platform` team do anything is the same rule the LLM lab uses. These are the rules the file adds for MCP:

```rego
# MCP clients send JSON-RPC messages to the path /mcp. OPA parses each message into parsed_body.
mcp_request if startswith(input.attributes.request.http.path, "/mcp")

rpc := input.parsed_body

# Tools the marketing team may not call.
marketing_denied_tools := {"get_full_page"}

# Marketing may start a session, list tools, and send other MCP messages.
result := {"allowed": true} if {
	mcp_request
	claims.team == "marketing"
	not rpc.method == "tools/call"
}

# Marketing may call tools that are not on the denied list.
result := {"allowed": true} if {
	mcp_request
	claims.team == "marketing"
	rpc.method == "tools/call"
	not rpc.params.name in marketing_denied_tools
}

result := {
	"allowed": false,
	"http_status": 403,
	"body": sprintf("denied by OPA: team %s may not call tool %s\n", [claims.team, rpc.params.name]),
} if {
	mcp_request
	claims.team == "marketing"
	rpc.method == "tools/call"
	rpc.params.name in marketing_denied_tools
}
```

A tool call reaches OPA as a body like `{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_full_page",...}}`. The rules read `method` and `params.name` from it. The rules check the path `/mcp`, so they never apply to LLM requests.

## Step 1: Add the External authz policy

1. In the sidebar, under **MCP**, click **Policies**.
2. Click the **External authz** card.

   ![MCP Policies page with the External authz card](../../images/mcp/mcp-opa-authorization/01-policies.png)

3. In **Host**, replace `127.0.0.1:9000` with `opa:9000`.
4. Leave **Protocol** as **gRPC** and **Failure mode** as **Deny**.
5. Click **Include request body** to turn it on.
6. In **Max request bytes**, enter `8192`.
7. Click **Save policy**.

   ![External authz panel with the host opa:9000 and Include request body on](../../images/mcp/mcp-opa-authorization/02-extauthz-form.png)

Docker Compose puts the gateway and OPA on the same network, so the gateway reaches OPA by its container name, `opa`. Without **Include request body**, OPA sees only the path and headers, and every MCP message looks the same. **Failure mode** **Deny** means that the gateway rejects requests when it cannot reach OPA.

## Step 2: Try the Tool Playground without a token

1. Wait two seconds for the gateway to load the policy.
2. In the sidebar, click **Tool Playground**.
3. Click **Initialize**.

The playground shows **MCP request failed** with `denied by OPA: send a valid workshop token`, and **Session** stays `not initialized`. OPA wrote that message, and the gateway did not pass the request to the MCP server.

![Tool Playground showing MCP request failed: denied by OPA: send a valid workshop token](../../images/mcp/mcp-opa-authorization/03-no-token.png)

If you see **3 tools discovered** instead, the gateway has not loaded the policy yet. Reload the page and click **Initialize** again.

## Step 3: Call tools as bob

1. Reload the page.
2. Click **Authorization header** to open it.
3. In **Bearer token**, paste bob's token from `lib/jwt/tokens/bob.jwt`. Paste only the token. The playground adds `Bearer ` in front of it.

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYm9iIiwidGVhbSI6Im1hcmtldGluZyIsImlhdCI6MTc5MjE4NTAzMCwiZXhwIjoyMDgyNzU4NDAwfQ.icKID7IKO2O_p3M8PXxkoA6of3ARV_nQ8euLcdP0Mc7NpaxPVvs-alcGXul47Z5ZzXH4DtZIvJSOTbZvvDjOvz3Jt5bUriuydVRoxohAdBI7KasQt71nF8c00XC6SfRzqlI23D-pcE_Ya7d7LclRiTWvAtuANuHhX_Y4lcSZ2TNwdqbTVe3f-jpmi6mNprdqlL_ASOTwS0UephXs2ong9gxP_w546qcGtAZl48lvr2a7Fd2ESEKAWsMX3H7xPNDDmmth9CY3ZxxXA7QL2RL5Llpxt7azkTQ0AfSGVNfUgD9vnXMwsQpfNRrNySl3epne4HoUUg5LmwID36pvbX9rvg
   ```

4. Click **Initialize**.

   ![Tool Playground with bob's token in Bearer token](../../images/mcp/mcp-opa-authorization/04-bob-token.png)

   The **Result** panel lists **3 tools discovered**. OPA lets bob start a session and list the tools.

5. In **Tool**, select **get_full_page**.
6. In **url**, enter `https://docs.solo.io/agentgateway/latest/`.
7. Click **Call tool**.

   ![Tool Playground with get_full_page and the URL filled in](../../images/mcp/mcp-opa-authorization/05-bob-get-full-page.png)

The playground shows **MCP request failed** with `denied by OPA: team marketing may not call tool get_full_page`. The **Result** panel still shows the tool list from **Initialize**, because the call never reached the MCP server.

![Tool Playground showing denied by OPA: team marketing may not call tool get_full_page](../../images/mcp/mcp-opa-authorization/06-bob-denied.png)

8. In **Tool**, select **search**.
9. In **query**, enter `What is agentgateway?`.
10. In **product**, select **solo-enterprise-for-agentgateway**.
11. Click **Call tool**.

The **Tool output** shows search results from the Solo.io docs, starting with **Result 1**. Bob uses the same token and the same session as before. Only the tool name in the body changed, and OPA allowed this call.

![Tool output with search results for bob](../../images/mcp/mcp-opa-authorization/07-bob-search.png)

## Step 4: Call get_full_page as alice

1. Reload the page.
2. Click **Authorization header** to open it.
3. In **Bearer token**, paste alice's token from `lib/jwt/tokens/alice.jwt`:

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYWxpY2UiLCJ0ZWFtIjoicGxhdGZvcm0iLCJpYXQiOjE3OTIxODUwMzAsImV4cCI6MjA4Mjc1ODQwMH0.aTQQX7hEmLLAtzewO2RijvGtIascY2iKF3i4T9YL4IYXf39iPLs_WzLRwR_nCVedA29FtEux3lgUbVm_7G-pvENFs2WZ8oXqq92faPQVZacT7HOs-Jr_xrEH94LQMwge9Wz3wbjTVlED6b6ttXK2SIKQfJPC5WSMC1DgpwjfGM8PBABsbt3eauLViL_FRcrDzgGz5OAUJSN_XuqyN-6xo05WVdNmDK7wfNs2dboxCLgGz7qQMSfg3IbJzviRbS2lKP3_nQTwXNqJVB5-_2hOHytmyg4AMWaAEk6a49O2xNq9zMBoUQM5stzZ7CpgcKe1zLgvGB9HyNDU01pNod6DkA
   ```

4. Click **Initialize**.
5. In **Tool**, select **get_full_page**.
6. In **url**, enter `https://docs.solo.io/agentgateway/latest/`.
7. Click **Call tool**.

Alice is in `platform`, so OPA allows every tool. The **Tool output** shows the page, starting with `# Solo Enterprise for agentgateway latest (Kubernetes)`:

![Tool output with the get_full_page result for alice](../../images/mcp/mcp-opa-authorization/08-alice-allowed.png)

## Check it

OPA writes a decision log for every request. To see the denials, run this from the `setup/` folder:

```bash
docker compose logs opa | grep -o '"result":{"allowed":false[^}]*}'
```

The output includes these two lines, one for Step 2 and one for bob's `get_full_page` call:

```
"result":{"allowed":false,"body":"denied by OPA: send a valid workshop token\n","http_status":403}
"result":{"allowed":false,"body":"denied by OPA: team marketing may not call tool get_full_page\n","http_status":403}
```

Each log entry also holds the request OPA saw, including the JSON-RPC body under `parsed_body`. If you did the LLM lab first, the output also has the denials from that lab.

<details>
<summary>Optional: check with curl</summary>

Start a session with bob's token, then call `get_full_page` in that session. Run this from the `setup/` folder:

```bash
TOKEN=$(cat ../lib/jwt/tokens/bob.jwt)
SESSION=$(curl -si http://localhost:4001/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  | grep -i '^mcp-session-id:' | awk '{print $2}' | tr -d '\r')
curl -si http://localhost:4001/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_full_page","arguments":{"url":"https://docs.solo.io/agentgateway/latest/"}}}'
```

Expected output:

```
HTTP/1.1 403 Forbidden
...

denied by OPA: team marketing may not call tool get_full_page
```

</details>

## What the UI wrote

In the sidebar, scroll down to **Tools** and click **Raw Configuration**. The UI added an `extAuthz` policy under `mcp.policies`:

```yaml
mcp:
  policies:
    extAuthz:
      host: opa:9000
      failureMode: deny
      includeRequestBody:
        maxRequestBytes: 8192
      protocol:
        grpc:
          context: {}
          metadata: {}
```

## Clean up

1. In the sidebar, under **MCP**, click **Policies**.
2. Click the **External authz** card.
3. Click **Delete policy** (the trash icon at the top of the panel).

   ![External authz panel with the Delete policy button](../../images/mcp/mcp-opa-authorization/09-delete-policy.png)

4. Click **Delete policy** to confirm. The card shows **disabled**.
5. From the `setup/` folder, stop OPA:

   ```bash
   docker compose --profile opa stop opa
   ```
