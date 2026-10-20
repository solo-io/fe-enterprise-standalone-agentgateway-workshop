# Guard MCP Tool Calls with a Policy Server

## Before you start

- Complete [001: Set Up Standalone Agentgateway](../../001-set-up-standalone-agentgateway.md).
- Start the procurement MCP server and its two policy servers. From the `setup/` folder, run:

  ```bash
  env UID=$(id -u) GID=$(id -g) docker compose --profile mcp-guardrails up -d
  ```

  This starts three containers:

  | Container | What it does |
  |---|---|
  | `procurement-mcp` | A mock procurement MCP server with 5 tools: `get_supplier`, `list_purchase_orders`, `create_purchase_order`, `send_supplier_email` and `delete_supplier`. |
  | `extmcp-authz` | A policy server that decides which tools each caller can see and call, and checks purchase order amounts and email recipients. It reads `setup/extmcp/authz.yaml`. |
  | `extmcp-redact` | A policy server that masks bank account and tax ID numbers in tool results. It reads `setup/extmcp/redact.yaml`. |

## What you'll do

- Add the procurement MCP server and require a token
- See that every caller gets every tool and the suppliers' bank details
- Add two MCP guardrails: one that checks each tool call, and one that masks payment data
- See a purchase order over the caller's limit denied, and an email to an outside domain blocked
- Stop each policy server and compare **Fail closed** with **Fail open**
- Change a limit in the policy file while the gateway keeps running

## Why this matters

An agent with access to a procurement system can create orders, email suppliers and read payment details. A rule such as "a buyer can order up to $10,000" depends on the value of the `amount` argument, so the gateway must look inside the tool call. MCP guardrails do this: for each MCP method you choose, the gateway sends the call or its result to a policy server. The policy server allows it, denies it with a message for the agent, or returns a changed version.

The authorization policy in `setup/extmcp/authz.yaml` defines three personas. The persona comes from the `persona` claim in the caller's token.

| Persona | Token | Tools | Purchase order limit |
|---|---|---|---|
| `requester` | `lib/jwt/tokens/requester.jwt` | `get_supplier`, `list_purchase_orders`, `create_purchase_order` | $1,000 |
| `buyer` | `lib/jwt/tokens/buyer.jwt` | the requester's tools and `send_supplier_email` | $10,000 |
| `finance-approver` | `lib/jwt/tokens/finance-approver.jwt` | all tools | $250,000 |

The policy also allows email only to the domain `try-solo.io`.

## Set up

This lab turns on MCP. [Connect a Remote MCP Server](connect-remote-mcp-server.md) explains these steps.

Turn on MCP:

1. In the sidebar, under **MCP**, click **Get started**.

   ![Sidebar with Get started under MCP](../../images/mcp/connect-remote-mcp-server/01-sidebar-get-started.png)

2. Click **Enable**.

   ![Enable MCP page](../../images/mcp/connect-remote-mcp-server/02-enable-mcp.png)

Allow the Tool Playground to connect:

1. In the sidebar, click **Tool Playground**.
2. Click **Apply CORS**.

   ![Tool Playground with the Apply CORS button](../../images/mcp/connect-remote-mcp-server/05-apply-cors.png)

3. Wait two seconds, then reload the page.

## Step 1: Add the procurement MCP server

1. In the sidebar, under **MCP**, click **Servers**.
2. Click **Add server**.
3. In **Server name**, enter `procurement`.
4. In **URL**, enter `http://procurement-mcp:8000/mcp`.
5. Click **Save server**.

   ![Add server dialog with the procurement server](../../images/mcp/mcp-guardrails/01-add-server.png)

The `procurement` row shows **ready**.

## Step 2: Require a token

The policy server needs to know who is calling, so the gateway must check a token first.

1. In the sidebar, under **MCP**, click **Policies**.
2. Click the **MCP authentication** card.
3. Leave **Validation mode** on **Strict**.
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

   ![MCP authentication panel with the inline JWKS, issuer and audience](../../images/mcp/mcp-guardrails/03-authn.png)

## Step 3: See what the buyer can do without guardrails

1. Wait two seconds, then in the sidebar click **Tool Playground**.
2. Click **Authorization header** to open it.
3. In **Bearer token**, paste the buyer's token from `lib/jwt/tokens/buyer.jwt`:

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYmFpbGV5IiwicGVyc29uYSI6ImJ1eWVyIiwiaWF0IjoxNzkyNDM0NTg5LCJleHAiOjIwODI3NTg0MDB9.JZSNu8kCNcYLw3Ypqs1mAUoL3glB8jU_Gw6gOy1hx_bkO75u9Q2xZJMNTbnWAjZ3iepetKBOGq9LyEvTH9ufh9SIYnj4FgbVC6brQX4Erw5rJNXE4pyWxgRTQZFb9LTQbfE3vfADijjb1__NTkh2R7Me1U0IduqAZzgjOkO5pWNpIxHAc19r-1Xw3c3L8pS-gye7HLHRSaLY0eE7NFxWZxr4LStLpa3dBZrgEJ58p-G9-WYAI8hClNPDapbcNLsSvp67ubpEvOGQ5XJoPnM-mycD6g8FwtwAoFYxxIh0EdcrRq9pczW7axm2q_ZQnIhfoY3KE9HrN5zHngsotMGwvQ
   ```

4. Click **Initialize**.

   ![Tool Playground with the buyer token in Bearer token](../../images/mcp/mcp-guardrails/04-buyer-token.png)

The **Result** panel lists **5 tools discovered**: the 5 procurement tools. Open the **Tool** list. The buyer sees `delete_supplier`.

![Tool list for the buyer that includes delete_supplier](../../images/mcp/mcp-guardrails/05-baseline-tools.png)

5. In **Tool**, select **get_supplier**.
6. In **id**, enter `SUP-001`.
7. Click **Call tool**.

The **Tool output** shows the supplier's `bankAccount` `004815162342` and `taxId` `94-3175520`. Any agent that calls this tool gets the payment details.

![Tool output with the bank account and tax ID](../../images/mcp/mcp-guardrails/06-baseline-supplier.png)

## Step 4: Add the policy server that checks each call

1. In the sidebar, under **MCP**, click **Policies**.
2. Click the **MCP guardrails** card.

   ![MCP Policies page with the MCP guardrails card](../../images/mcp/mcp-guardrails/07-guardrails-card.png)

3. Click **Add processor**.
4. In **Host**, enter `extmcp-authz:9001`.
5. Leave **Failure mode** on **Fail closed**.
6. Under **Method phases**, the row `tools/call` **Request** is already there. In the empty method box, enter `tools/list`, select **Response** in the list next to it, and click **Add**.
7. Under **Metadata**, enter `persona` in **metadata key** and `jwt.persona` in **CEL expression**, then click **Add**.
8. Enter `sub` and `jwt.sub` the same way, then click **Add**.
9. Click **Save policy**.

   ![Processor 1 with host extmcp-authz:9001, two method phases and two metadata values](../../images/mcp/mcp-guardrails/08-authz-processor.png)

The two method phases tell the gateway when to call the policy server:

- `tools/call` **Request**: before a tool call reaches the MCP server, so the policy server can allow or deny it.
- `tools/list` **Response**: after the MCP server returns its tool list, so the policy server can remove tools.

The metadata sends the caller's `persona` and `sub` claims to the policy server with each call. The gateway checks the token before it runs any processor, so the claims are verified.

## Step 5: Add the policy server that masks payment data

1. Click the **MCP guardrails** card again.
2. Click **Add processor**. **Processor 2** appears under processor 1.
3. In the **Host** field of processor 2, enter `extmcp-redact:9001`.
4. In the **Failure mode** list of processor 2, select **Fail open**.
5. Under **Method phases** of processor 2, click **Remove** on the `tools/call` **Request** row.
6. In the empty method box, enter `tools/call`, select **Response**, and click **Add**.
7. Click **Save policy**.

   ![Processor 2 with host extmcp-redact:9001, Fail open and tools/call Response](../../images/mcp/mcp-guardrails/09-redact-processor.png)

Processors run in the order listed, and the first denial stops the call. This processor sees each tool result after the MCP server returns it, and replaces bank account and tax ID numbers with `<BANK_ACCOUNT>` and `<TAX_ID>`. It is **Fail open** so that Step 6 can show what happens to tool results when this policy server is down.

## Check it

Connect as the buyer again:

1. Wait two seconds, then in the sidebar click **Tool Playground**.
2. Click **Authorization header**, paste the buyer's token in **Bearer token**, and click **Initialize**.

The **Result** panel lists **4 tools discovered**: `create_purchase_order`, `get_supplier`, `list_purchase_orders` and `send_supplier_email`. The policy server removed every tool that is not on the buyer's list, including `delete_supplier`.

![Tool list for the buyer with four procurement tools](../../images/mcp/mcp-guardrails/10-buyer-tools.png)

Now call the tools:

1. In **Tool**, select **get_supplier**. In **id**, enter `SUP-001`, and click **Call tool**.

   The **Tool output** shows `"bankAccount":"<BANK_ACCOUNT>"` and `"taxId":"<TAX_ID>"`. The agent's model receives only the masked values.

   ![Tool output with the bank account and tax ID masked](../../images/mcp/mcp-guardrails/11-masked.png)

2. In **Tool**, select **create_purchase_order**. Enter `SUP-002` in **supplier**, `25000` in **amount** and `Forklift` in **description**, and click **Call tool**.

   The **Tool output** shows `amount $25000 exceeds the $10000 limit for buyer; approval required`. The message names the limit, so the agent can tell the user what to do next.

   ![Tool output with the purchase order denied over the limit](../../images/mcp/mcp-guardrails/12-over-limit.png)

3. Change **amount** to `5000` and **description** to `Pallet racking`, and click **Call tool**.

   The **Tool output** shows a new order with `"status":"created"`. $5,000 is within the buyer's limit.

4. In **Tool**, select **send_supplier_email**. Enter `x@gmail.com` in **to**, `Bank details` in **subject** and `See attached` in **body**, and click **Call tool**.

   The **Tool output** shows `recipient domain gmail.com not allowed`.

   ![Tool output with the email to gmail.com blocked](../../images/mcp/mcp-guardrails/13-email-denied.png)

A denied call reaches the agent as a tool result marked as an error, with the policy server's message as its text. The MCP server never receives the call.

Now connect as the requester:

1. Reload the page.
2. Click **Authorization header** and paste the requester's token from `lib/jwt/tokens/requester.jwt`:

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoicmlsZXkiLCJwZXJzb25hIjoicmVxdWVzdGVyIiwiaWF0IjoxNzkyNDM0NTg5LCJleHAiOjIwODI3NTg0MDB9.St0JwypoVKu7J2TGZQtRjz77a2XsBFVMRNDiLirwtr45_9TrquBmcpO5mw3D8ztvqYYuExyAHcmLe-kgSpRM9jzGXKB_0HTgScOkvgSi9x9fNqP3R0htQHxZIhAl5D2bu-kobaeXc5-kCh-5awTH102270gcEhq_XGIL3eXIxKtFCeDIW-UEqLqOxsvxjxdtZ8JFN_jPDPcH05OaOB6WNrBUDd6HbygCCO_jiVwdc7ouCsMohlqMylEKOgMbhm77oJAW-ukDt2W-Wkxch3Szwo1-qrwgB3RGkV_VoT4dvTj32tGOtzp5zvWdaMDSVgBGoOCvKHnOS1w-z8CYKZKRtw
   ```

3. Click **Initialize**.

The **Result** panel lists **3 tools discovered**. The requester cannot email suppliers. If the requester's client calls `delete_supplier` anyway, the policy server denies the call with `persona requester may not call delete_supplier`: the same policy server filters the tool list and checks each call, so a hidden tool stays blocked.

![Tool list for the requester with three tools](../../images/mcp/mcp-guardrails/14-requester-tools.png)

## Step 6: Compare Fail open with Fail closed

1. Stop the masking policy server. From the `setup/` folder, run:

   ```bash
   docker compose --profile mcp-guardrails stop extmcp-redact
   ```

2. In the Tool Playground, reload the page, paste the buyer's token in **Bearer token**, and click **Initialize**.
3. Call **get_supplier** with **id** `SUP-001`.

The call works, and the **Tool output** shows the real bank account and tax ID. The masking processor is **Fail open**, so the gateway skipped it: the agent keeps working, and the payment data goes through unmasked.

![Tool output with the real bank account after the masking server stopped](../../images/mcp/mcp-guardrails/15-redact-down.png)

4. Stop the authorization policy server:

   ```bash
   docker compose --profile mcp-guardrails stop extmcp-authz
   ```

5. In **Tool**, select **list_purchase_orders** and click **Call tool**.

After about 10 seconds, the **Result** panel shows an error with `mcpGuardrails checkRequest failed: upstream call timeout`. The authorization processor is **Fail closed**, so no call reaches the MCP server while the policy server is down, even calls the policy would allow.

![Result panel with the mcpGuardrails checkRequest failed error](../../images/mcp/mcp-guardrails/16-authz-down.png)

| Processor | Failure mode | With its policy server stopped |
|---|---|---|
| `extmcp-authz` | Fail closed | Every tool call fails. No unchecked call reaches the MCP server. |
| `extmcp-redact` | Fail open | Tool calls work. Payment data is not masked. |

6. Start both policy servers again:

   ```bash
   docker compose --profile mcp-guardrails start extmcp-authz extmcp-redact
   ```

7. Wait a few seconds. Reload the Tool Playground, connect with the buyer's token, and call **get_supplier** with **id** `SUP-001`. The **Tool output** shows `<BANK_ACCOUNT>` again.

## Step 7: Change a limit without touching the gateway

The limits live in the policy server's file, so you can change them while the gateway runs.

1. Open `setup/extmcp/authz.yaml` in a text editor.
2. Under `buyer`, change `poLimit: 10000` to `poLimit: 2500`, and save the file.
3. Wait five seconds. The policy server checks the file for changes every 5 seconds.
4. In the Tool Playground, reload the page, connect with the buyer's token, and call **create_purchase_order** with **supplier** `SUP-002`, **amount** `5000` and **description** `Pallet racking`.

The **Tool output** shows `amount $5000 exceeds the $2500 limit for buyer; approval required`. The same order worked in **Check it**. The gateway configuration did not change.

![Tool output with the new $2500 limit](../../images/mcp/mcp-guardrails/17-new-limit.png)

If you save a file that does not parse, the policy server keeps the previous policy and logs `policy reload failed`. To see each decision, run `docker compose logs extmcp-authz` from the `setup/` folder.

## What the UI wrote

In the sidebar, scroll down to **Tools** and click **Raw Configuration**. The UI added the `procurement` target and two policies to the `mcp` section:

```yaml
mcp:
  targets:
  - name: procurement
    mcp:
      host: http://procurement-mcp:8000/mcp
  policies:
    ...
    mcpAuthentication:
      mode: strict
      issuer: solo-workshop
      audiences:
      - agentgateway
      jwks: |-
        { "keys": [ ... ] }
      resourceMetadata: {}
    mcpGuardrails:
      processors:
      - kind: remote
        host: extmcp-authz:9001
        failureMode: failClosed
        methods:
          tools/call: request
          tools/list: response
        metadata:
          persona: jwt.persona
          sub: jwt.sub
      - kind: remote
        host: extmcp-redact:9001
        failureMode: failOpen
        methods:
          tools/call: response
```

## Clean up

1. In `setup/extmcp/authz.yaml`, change the buyer's `poLimit: 2500` back to `poLimit: 10000`, and save the file.
2. Stop the helpers. From the `setup/` folder, run:

   ```bash
   docker compose --profile mcp-guardrails stop procurement-mcp extmcp-authz extmcp-redact
   ```

3. Turn off MCP. In the sidebar, scroll down to **Tools** and click **Raw Configuration**.
4. Select from the line `gateways:` to the end of the file. This is the `default` gateway on port `4001` and the `mcp:` section, with the `procurement` server, the CORS policy and the two MCP policies.

   ![Raw Configuration with the gateways and mcp sections selected](../../images/mcp/mcp-guardrails/18-turn-off-mcp.png)

5. Press **Delete**.
6. Click **Save**. If a confirmation appears, click **Save** again.

The gateway is back to the state [001](../../001-set-up-standalone-agentgateway.md) left it in.
