# Let Your Own Service Approve Each MCP Request

## Before you start

- Complete [Connect a Remote MCP Server](../mcp/connect-remote-mcp-server.md). The gateway serves the `solo-docs` MCP server on port `4001`.
- Start the workshop's authorization service. From the `setup/` folder, run:

  ```bash
  env UID=$(id -u) GID=$(id -g) docker compose --profile ext-authz-jwt up -d
  ```

  This starts the `ext-authz-jwt` container next to the gateway. It listens for gRPC on port `9000`.

## What you'll do

- Point the MCP gateway at an external authorization service
- See the Tool Playground denied without a token
- Connect with a token for `alice` and see the tools
- Connect with a token for `bob` and see the service deny him

## Why this matters

Some access rules live outside the gateway: an entitlement system, a license check, a list of approved customers. External authorization lets the gateway ask your own service about every MCP request before the request reaches an MCP server. The service answers allow or deny, and the gateway enforces the answer.

The service in this lab reads the JWT in the `Authorization` header and allows a request only when the token has the claim `team: platform`. Your real service can check any header, the path or the body. The service sees each MCP message as an HTTP request, so it does not see which tool a client calls. To allow or deny single tools, see [Require a Token for MCP and Limit Tools by Team](mcp-auth-and-tool-authorization.md) and [Guard MCP Tool Calls with a Policy Server](mcp-guardrails.md).

The lab uses the workshop tokens in `lib/jwt/`:

| Token | `sub` | `team` |
|---|---|---|
| `lib/jwt/tokens/alice.jwt` | `alice` | `platform` |
| `lib/jwt/tokens/bob.jwt` | `bob` | `marketing` |

## Step 1: Add the External authz policy

1. In the sidebar, under **MCP**, click **Policies**.
2. Click the **External authz** card.

   ![MCP Policies page with the External authz card](../../images/mcp/mcp-external-authorization/01-policies.png)

3. In **Host**, replace `127.0.0.1:9000` with `ext-authz-jwt:9000`.
4. Leave **Protocol** as **gRPC** and **Failure mode** as **Deny**.
5. Click **Save policy**.

   ![External authz panel with the host ext-authz-jwt:9000](../../images/mcp/mcp-external-authorization/02-extauthz-form.png)

`ext-authz-jwt` is the name of the service container. Docker Compose puts the gateway and the service on the same network, so the gateway reaches the service by that name. **Failure mode** **Deny** means that the gateway rejects requests when it cannot reach the service.

## Step 2: Try the Tool Playground without a token

1. Wait two seconds for the gateway to load the policy.
2. In the sidebar, click **Tool Playground**.
3. Click **Initialize**.

The playground shows **MCP request failed** with `denied by ext_authz: missing Authorization header`, and **Session** stays `not initialized`. The service wrote that message. The gateway returned it with HTTP `403` and did not pass the request to the MCP server.

![Tool Playground showing MCP request failed: missing Authorization header](../../images/mcp/mcp-external-authorization/03-no-token.png)

## Step 3: Connect with alice's token

1. Reload the page.
2. Click **Authorization header** to open it.
3. In **Bearer token**, paste alice's token from `lib/jwt/tokens/alice.jwt`. Paste only the token. The playground adds `Bearer ` in front of it for you.

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYWxpY2UiLCJ0ZWFtIjoicGxhdGZvcm0iLCJpYXQiOjE3OTIxODUwMzAsImV4cCI6MjA4Mjc1ODQwMH0.aTQQX7hEmLLAtzewO2RijvGtIascY2iKF3i4T9YL4IYXf39iPLs_WzLRwR_nCVedA29FtEux3lgUbVm_7G-pvENFs2WZ8oXqq92faPQVZacT7HOs-Jr_xrEH94LQMwge9Wz3wbjTVlED6b6ttXK2SIKQfJPC5WSMC1DgpwjfGM8PBABsbt3eauLViL_FRcrDzgGz5OAUJSN_XuqyN-6xo05WVdNmDK7wfNs2dboxCLgGz7qQMSfg3IbJzviRbS2lKP3_nQTwXNqJVB5-_2hOHytmyg4AMWaAEk6a49O2xNq9zMBoUQM5stzZ7CpgcKe1zLgvGB9HyNDU01pNod6DkA
   ```

4. Click **Initialize**.

   ![Tool Playground with the alice token in Bearer token](../../images/mcp/mcp-external-authorization/04-alice-token.png)

**Session** shows a session ID, and the **Result** panel lists **3 tools discovered**. The service found `team: platform` in alice's token and allowed the request.

![Result panel with 3 tools discovered](../../images/mcp/mcp-external-authorization/05-alice-allowed.png)

## Check it

1. Reload the page.
2. Click **Authorization header** to open it.
3. In **Bearer token**, paste bob's token from `lib/jwt/tokens/bob.jwt`:

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYm9iIiwidGVhbSI6Im1hcmtldGluZyIsImlhdCI6MTc5MjE4NTAzMCwiZXhwIjoyMDgyNzU4NDAwfQ.icKID7IKO2O_p3M8PXxkoA6of3ARV_nQ8euLcdP0Mc7NpaxPVvs-alcGXul47Z5ZzXH4DtZIvJSOTbZvvDjOvz3Jt5bUriuydVRoxohAdBI7KasQt71nF8c00XC6SfRzqlI23D-pcE_Ya7d7LclRiTWvAtuANuHhX_Y4lcSZ2TNwdqbTVe3f-jpmi6mNprdqlL_ASOTwS0UephXs2ong9gxP_w546qcGtAZl48lvr2a7Fd2ESEKAWsMX3H7xPNDDmmth9CY3ZxxXA7QL2RL5Llpxt7azkTQ0AfSGVNfUgD9vnXMwsQpfNRrNySl3epne4HoUUg5LmwID36pvbX9rvg
   ```

4. Click **Initialize**.

The playground shows **MCP request failed** with `denied by ext_authz: claim team=marketing does not match required value platform`. Bob has a valid token, but his `team` claim is `marketing`, so the service denies him.

![Tool Playground showing bob denied by ext_authz](../../images/mcp/mcp-external-authorization/06-bob-denied.png)

> **Note:** The workshop service decodes the token but does not check its signature. In production, turn on **MCP authentication** as well, so the gateway checks the signature before it calls your service. [Require a Token for MCP and Limit Tools by Team](mcp-auth-and-tool-authorization.md) shows how.

<details>
<summary>Optional: check with curl</summary>

Without a token, the service denies the request:

```bash
curl -si http://localhost:4001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Expected output:

```
HTTP/1.1 403 Forbidden
x-ext-authz-check-result: denied
...

denied by ext_authz: missing Authorization header
```

Send alice's token in the `Authorization` header. Run this from the `setup` folder:

```bash
TOKEN=$(cat ../lib/jwt/tokens/alice.jwt)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4001/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Expected output:

```
200
```

</details>

## What the UI wrote

In the sidebar, scroll down to **Tools** and click **Raw Configuration**. The UI added an `extAuthz` policy under `mcp.policies`:

```yaml
mcp:
  policies:
    extAuthz:
      host: ext-authz-jwt:9000
      failureMode: deny
      protocol:
        grpc:
          context: {}
          metadata: {}
```

## Clean up

1. In the sidebar, under **MCP**, click **Policies**.
2. Click the **External authz** card.
3. Click **Delete policy** (the trash icon at the top of the panel).

   ![External authz panel with the Delete policy button](../../images/mcp/mcp-external-authorization/07-delete-policy.png)

4. Click **Delete policy** to confirm. The card shows **disabled**.
5. From the `setup/` folder, stop the authorization service:

   ```bash
   docker compose --profile ext-authz-jwt stop ext-authz-jwt
   ```
