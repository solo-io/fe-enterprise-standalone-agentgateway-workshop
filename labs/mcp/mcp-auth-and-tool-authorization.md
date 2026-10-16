# Require a Token for MCP and Limit Tools by Team

## Before you start

- Complete [Connect a Remote MCP Server](../mcp/connect-remote-mcp-server.md). The gateway serves the `solo-docs` MCP server on port `4001`.

## What you'll do

- Require a signed JWT for every MCP request
- See the gateway reject a client that has no token
- Connect with a token for `alice` and see all tools
- Add a rule that hides the `search` tool from the `marketing` team
- Connect with a token for `bob` and see that `search` is gone

## Why this matters

Without authentication, anyone who can reach port `4001` can call every tool on every MCP server behind the gateway. With MCP authentication, the gateway checks a JWT on each request, so it knows who the caller is. MCP authorization then uses the claims in that token to decide which tools each caller can see and call. The MCP servers do not need to change.

This workshop includes a signing key and two tokens in `lib/jwt/`:

| Token | `sub` | `team` |
|---|---|---|
| `lib/jwt/tokens/alice.jwt` | `alice` | `platform` |
| `lib/jwt/tokens/bob.jwt` | `bob` | `marketing` |

Both tokens have issuer `solo-workshop` and audience `agentgateway`.

## Step 1: Turn on MCP authentication

1. In the sidebar, under **MCP**, click **Policies**.
2. Click the **MCP authentication** card.

   ![MCP Policies page with the MCP authentication card](../../images/mcp/mcp-auth-and-tool-authorization/01-policies.png)

3. Leave **Validation mode** on **Strict**. In Strict mode, the gateway rejects every request without a valid token.
4. Under **JWKS source**, click **Inline JSON**.
5. In **Inline JWKS**, select the sample text and replace it with the public key set from `lib/jwt/public-jwks.json`:

   ```json
   {
     "keys": [
       {
         "kty": "RSA",
         "use": "sig",
         "alg": "RS256",
         "kid": "workshop-1",
         "n": "7LOYrKKAIul3gtIN3zUtDNzEOaiwPvGE9ZpaQ3JkTIRbBjU2zHMKtS8qxVzDWsvVX2_KP_o6esKT9Chk-B3DOGWmCdVM4N55lxU02pPUsH1J5Et52aFyj9fXErDIDgceWsDR8rPSAqnbNdqJfEm3X3psc3vYQhgLQj9CYv5azHJJYV0ql70urVm8aHOke3mQoPdBcXbhRqJ-ANCk0Z7x_O1CwqqD3IUKnuXFEpQ2RHHAlK72S09zV36ptk3KUz-r_vU5BkGrwy0ZEb4W5wLpqoVR2Nje4SkmBKpiZ-cumo-MNLKuoXl7undKYNtxikBVmuWVFTwCxyGD9ijDUFz6bw",
         "e": "AQAB"
       }
     ]
   }
   ```

6. In **Issuer**, enter `solo-workshop`.
7. Under **Audiences**, enter `agentgateway`, then click **Add**.
8. Click **Save policy**.

   ![MCP authentication panel with the inline JWKS, issuer and audience](../../images/mcp/mcp-auth-and-tool-authorization/02-authn.png)

The **MCP authentication** card now shows **enabled**.

## Step 2: Try the Tool Playground without a token

1. Wait two seconds for the gateway to load the policy.
2. In the sidebar, click **Tool Playground**.
3. Click **Initialize**.

The playground shows **MCP request failed** with `JWT token required`, and **Session** stays `not initialized`. The gateway answered with HTTP `401` and did not pass the request to the MCP server.

![Tool Playground showing MCP request failed: JWT token required](../../images/mcp/mcp-auth-and-tool-authorization/03-no-token.png)

## Step 3: Connect with alice's token

1. Reload the page.
2. Click **Authorization header** to open it.
3. In **Bearer token**, paste alice's token from `lib/jwt/tokens/alice.jwt`. Paste only the token. The playground adds `Bearer ` in front of it for you.

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYWxpY2UiLCJ0ZWFtIjoicGxhdGZvcm0iLCJpYXQiOjE3OTIxODUwMzAsImV4cCI6MjA4Mjc1ODQwMH0.aTQQX7hEmLLAtzewO2RijvGtIascY2iKF3i4T9YL4IYXf39iPLs_WzLRwR_nCVedA29FtEux3lgUbVm_7G-pvENFs2WZ8oXqq92faPQVZacT7HOs-Jr_xrEH94LQMwge9Wz3wbjTVlED6b6ttXK2SIKQfJPC5WSMC1DgpwjfGM8PBABsbt3eauLViL_FRcrDzgGz5OAUJSN_XuqyN-6xo05WVdNmDK7wfNs2dboxCLgGz7qQMSfg3IbJzviRbS2lKP3_nQTwXNqJVB5-_2hOHytmyg4AMWaAEk6a49O2xNq9zMBoUQM5stzZ7CpgcKe1zLgvGB9HyNDU01pNod6DkA
   ```

4. Click **Initialize**.

   ![Tool Playground with the alice token in Bearer token](../../images/mcp/mcp-auth-and-tool-authorization/04-alice-token.png)

**Session** shows a session ID, and the **Result** panel lists **3 tools discovered**. Open the **Tool** list: alice sees `search`, `get_chunks` and `get_full_page`.

![Tool list for alice with search, get_chunks and get_full_page](../../images/mcp/mcp-auth-and-tool-authorization/05-alice-tools.png)

## Step 4: Hide the search tool from the marketing team

An MCP authorization rule is a CEL expression. The gateway checks it for each tool. In the expression, `mcp.tool.name` is the tool's name and `jwt.<claim>` is a claim from the caller's token, for example `jwt.team`.

1. In the sidebar, under **MCP**, click **Policies**.
2. Click the **MCP authorization** card.

   ![MCP Policies page with the MCP authorization card](../../images/mcp/mcp-auth-and-tool-authorization/06-authz-card.png)

3. Click **Add rule**.
4. In the **Rule 1** list, select **Deny**.
5. In the expression box, replace the sample text with this expression:

   ```
   mcp.tool.name == "search" && jwt.team == "marketing"
   ```

6. Click **Save policy**.

   ![MCP authorization panel with the Deny rule](../../images/mcp/mcp-auth-and-tool-authorization/07-authz-rule.png)

The rule denies the `search` tool when the caller's `team` claim is `marketing`. All other tools and callers stay allowed. To test an expression before you save it, click **Playground** next to the rule.

## Check it

1. Wait two seconds, then in the sidebar click **Tool Playground**.
2. Click **Authorization header** to open it.
3. In **Bearer token**, paste bob's token from `lib/jwt/tokens/bob.jwt` (replace any token in the field):

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYm9iIiwidGVhbSI6Im1hcmtldGluZyIsImlhdCI6MTc5MjE4NTAzMCwiZXhwIjoyMDgyNzU4NDAwfQ.icKID7IKO2O_p3M8PXxkoA6of3ARV_nQ8euLcdP0Mc7NpaxPVvs-alcGXul47Z5ZzXH4DtZIvJSOTbZvvDjOvz3Jt5bUriuydVRoxohAdBI7KasQt71nF8c00XC6SfRzqlI23D-pcE_Ya7d7LclRiTWvAtuANuHhX_Y4lcSZ2TNwdqbTVe3f-jpmi6mNprdqlL_ASOTwS0UephXs2ong9gxP_w546qcGtAZl48lvr2a7Fd2ESEKAWsMX3H7xPNDDmmth9CY3ZxxXA7QL2RL5Llpxt7azkTQ0AfSGVNfUgD9vnXMwsQpfNRrNySl3epne4HoUUg5LmwID36pvbX9rvg
   ```

4. Click **Initialize**.
5. Open the **Tool** list.

The **Result** panel lists **2 tools discovered**, and the **Tool** list has only `get_chunks` and `get_full_page`. The gateway removed `search` from bob's tool list.

![Tool list for bob with get_chunks and get_full_page only](../../images/mcp/mcp-auth-and-tool-authorization/08-bob-tools.png)

Reload the page, then repeat steps 2 to 5 with alice's token. The **Result** panel lists **3 tools discovered**, and the **Tool** list has `search`, `get_chunks` and `get_full_page`. Alice still sees all 3 tools, because her `team` claim is `platform`.

If bob's client calls `search` anyway, the gateway rejects the call with `Unknown tool: search`.

<details>
<summary>Optional: check with curl</summary>

Without a token, the gateway returns `401`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Expected output:

```
401
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

In the sidebar, scroll down to **Tools** and click **Raw Configuration**. The UI added `mcpAuthentication` and `mcpAuthorization` under `mcp.policies`:

```yaml
mcp:
  policies:
    mcpAuthentication:
      mode: strict
      issuer: solo-workshop
      audiences:
      - agentgateway
      jwks: |-
        {
          "keys": [
            {
              "kty": "RSA",
              ...
            }
          ]
        }
      resourceMetadata: {}
    mcpAuthorization:
      rules:
      - deny: mcp.tool.name == "search" && jwt.team == "marketing"
```

## Clean up

1. In the sidebar, under **MCP**, click **Policies**.
2. Click the **MCP authorization** card.
3. Click the **Delete policy** icon at the top of the panel, then click **Delete policy** to confirm.
4. Click the **MCP authentication** card.
5. Click the **Delete policy** icon, then click **Delete policy** to confirm.

Both cards show **disabled**. MCP clients connect without a token again.
