# Decide Who Can Use Which Model with Open Policy Agent

## Before you start

- Complete [001: Set Up Standalone Agentgateway](../../001-set-up-standalone-agentgateway.md).
- Start Open Policy Agent (OPA) with the workshop policy. From the `setup/` folder, run:

  ```bash
  env UID=$(id -u) GID=$(id -g) docker compose --profile opa up -d
  ```

  This starts the `opa` container next to the gateway. It listens for gRPC on port `9000` and reads its policy from `setup/opa/`.

## What you'll do

- Point the gateway at OPA with the External authz policy
- Send the request body to OPA, so the policy can see the model
- See a request without a token denied in the Chat Playground
- Let alice use any model and limit bob to `openai/gpt-6-luna`
- Read OPA's decision log
- Change the policy file and see the new rule apply within seconds

## Why this matters

If your company already writes access rules in Rego, the gateway can use them: [OPA](https://www.openpolicyagent.org/) answers the gateway's External authz call. The gateway asks OPA about every request before it calls OpenAI. OPA returns allow or deny, and for a denial it can also return the message the caller sees.

How the policy in `setup/opa/policy.rego` decides:

1. It checks the token in the `Authorization` header against the workshop's public key, and checks the issuer and audience. OPA verifies the token itself, so the lab adds no JWT policy to the gateway.
2. It reads the `team` claim. Callers in `platform` can use any model.
3. Callers in `marketing` can use only `openai/gpt-6-luna`. The policy reads the model from the request body, which is why you turn on **Include request body** in Step 1.

The lab uses the workshop tokens in `lib/jwt/`:

| Token | `sub` | `team` | Allowed models |
|---|---|---|---|
| `lib/jwt/tokens/alice.jwt` | `alice` | `platform` | any |
| `lib/jwt/tokens/bob.jwt` | `bob` | `marketing` | `openai/gpt-6-luna` |

Here is the policy:

```rego
package envoy.authz

import rego.v1

# The gateway sends OPA every request. OPA answers with an object:
# allowed, and for a denial, the HTTP status and body to return.
default result := {
	"allowed": false,
	"http_status": 403,
	"body": "denied by OPA: send a valid workshop token\n",
}

headers := input.attributes.request.http.headers

# Check the token's signature, issuer and audience against the workshop JWKS.
claims := payload if {
	[_, bearer] := split(headers.authorization, "Bearer ")
	[valid, _, payload] := io.jwt.decode_verify(bearer, {
		"cert": json.marshal(data.jwks),
		"iss": "solo-workshop",
		"aud": "agentgateway",
	})
	valid
}

# The model the client asked for. OPA parses the JSON request body into parsed_body.
# Clients send the provider prefix.
model := input.parsed_body.model

# Models the marketing team may use.
marketing_models := {"openai/gpt-6-luna"}

result := {"allowed": true} if claims.team == "platform"

result := {"allowed": true} if {
	claims.team == "marketing"
	model in marketing_models
}

result := {
	"allowed": false,
	"http_status": 403,
	"body": sprintf("denied by OPA: team %s may not use model %s\n", [claims.team, model]),
} if {
	claims.team == "marketing"
	not model in marketing_models
}
```

## Set up

This lab uses the `openai/*` model. [Connect LLM Providers](connect-llm-providers.md) explains these steps.

1. In the sidebar, click **Models**.
2. Click **Add model**.

   ![Models page with no models yet](../../images/llm/connect-llm-providers/01-models-empty.png)

3. In **Provider**, select **OpenAI**. The UI fills **Incoming model match** with `openai/*`.
4. Next to **Provider API key**, click **Env var** and enter `OPENAI_API_KEY`.
5. Under **Outgoing model**, click **Strip openai/**.
6. Click **Save model**.

   ![Add model panel filled in for OpenAI](../../images/llm/connect-llm-providers/02-add-openai-model.png)

The **Models** page lists `openai/*`.

## Step 1: Add the External authz policy

1. In the sidebar, click **Policies**.
2. Click the **External authz** card.

   ![LLM Policies page with the External authz card](../../images/llm/opa-authorization/01-policies-extauthz-card.png)

3. In **Host**, replace `127.0.0.1:9000` with `opa:9000`.
4. Leave **Protocol** as **gRPC** and **Failure mode** as **Deny**.
5. Click **Include request body** to turn it on.
6. In **Max request bytes**, enter `8192`.
7. Click **Save policy**.

   ![External authz panel with the host opa:9000 and Include request body on](../../images/llm/opa-authorization/02-extauthz-form.png)

`opa` is the name of the OPA container. Docker Compose puts the gateway and OPA on the same network, so the gateway reaches OPA by that name. **Failure mode** **Deny** means that the gateway rejects requests when it cannot reach OPA.

## Step 2: Send a request without a token

1. Wait two seconds for the gateway to load the policy.
2. In the sidebar, click **Chat Playground**.
3. In **Model**, select **openai/\***.
4. In **Specific model**, enter `gpt-6-luna`.
5. In **User message**, enter `Reply with the single word: pong` and click **Send**.

The playground shows **Playground request failed** with the message from the policy:

![Chat Playground showing the request denied by OPA](../../images/llm/opa-authorization/03-playground-denied.png)

If you see a reply instead, the gateway has not loaded the policy yet. Wait two seconds and click **Send** again.

## Step 3: Send bob's token

The Chat Playground sends the **Raw API key** field as a bearer token.

1. In **Specific model**, enter `gpt-6.1-sol`.
2. In **Raw API key**, paste bob's token. Paste only the token, without `Bearer`.

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYm9iIiwidGVhbSI6Im1hcmtldGluZyIsImlhdCI6MTc5MjE4NTAzMCwiZXhwIjoyMDgyNzU4NDAwfQ.icKID7IKO2O_p3M8PXxkoA6of3ARV_nQ8euLcdP0Mc7NpaxPVvs-alcGXul47Z5ZzXH4DtZIvJSOTbZvvDjOvz3Jt5bUriuydVRoxohAdBI7KasQt71nF8c00XC6SfRzqlI23D-pcE_Ya7d7LclRiTWvAtuANuHhX_Y4lcSZ2TNwdqbTVe3f-jpmi6mNprdqlL_ASOTwS0UephXs2ong9gxP_w546qcGtAZl48lvr2a7Fd2ESEKAWsMX3H7xPNDDmmth9CY3ZxxXA7QL2RL5Llpxt7azkTQ0AfSGVNfUgD9vnXMwsQpfNRrNySl3epne4HoUUg5LmwID36pvbX9rvg
   ```

3. Click **Send**.

The policy reads `team: marketing` from the token. Bob may use only `openai/gpt-6-luna`, so OPA denies the request:

![Chat Playground showing OPA denying bob the model openai/gpt-6.1-sol](../../images/llm/opa-authorization/04-playground-bob-denied.png)

## Step 4: Send alice's token

1. Reload the page.
2. In **Model**, select **openai/\***.
3. In **Specific model**, enter `gpt-6.1-sol`.
4. In **Raw API key**, paste alice's token.

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYWxpY2UiLCJ0ZWFtIjoicGxhdGZvcm0iLCJpYXQiOjE3OTIxODUwMzAsImV4cCI6MjA4Mjc1ODQwMH0.aTQQX7hEmLLAtzewO2RijvGtIascY2iKF3i4T9YL4IYXf39iPLs_WzLRwR_nCVedA29FtEux3lgUbVm_7G-pvENFs2WZ8oXqq92faPQVZacT7HOs-Jr_xrEH94LQMwge9Wz3wbjTVlED6b6ttXK2SIKQfJPC5WSMC1DgpwjfGM8PBABsbt3eauLViL_FRcrDzgGz5OAUJSN_XuqyN-6xo05WVdNmDK7wfNs2dboxCLgGz7qQMSfg3IbJzviRbS2lKP3_nQTwXNqJVB5-_2hOHytmyg4AMWaAEk6a49O2xNq9zMBoUQM5stzZ7CpgcKe1zLgvGB9HyNDU01pNod6DkA
   ```

5. In **User message**, enter `Reply with the single word: pong` and click **Send**.

Alice is in `platform`, so OPA allows any model. The reply shows `pong` with the **OK** chip:

![Chat Playground showing the reply for alice](../../images/llm/opa-authorization/05-playground-alice-allowed.png)

## Check it

OPA writes a decision log for every request. From the `setup/` folder, run:

```bash
docker compose logs opa | grep -o '"result":{[^}]*}'
```

Expected output, one line for each request:

```
"result":{"allowed":false,"body":"denied by OPA: send a valid workshop token\n","http_status":403}
"result":{"allowed":false,"body":"denied by OPA: team marketing may not use model openai/gpt-6.1-sol\n","http_status":403}
"result":{"allowed":true}
```

<details>
<summary>Optional: check with curl</summary>

1. Send a request with no token:

   ```bash
   curl -si http://localhost:4000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'
   ```

   Expected output:

   ```
   HTTP/1.1 403 Forbidden
   ...

   denied by OPA: send a valid workshop token
   ```

2. Send bob's token with `openai/gpt-6-luna`. OPA allows it:

   ```bash
   curl -si http://localhost:4000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $(cat ../lib/jwt/tokens/bob.jwt)" \
     -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'
   ```

   Expected output:

   ```
   HTTP/1.1 200 OK
   ...
   ```

3. Send bob's token with `openai/gpt-6.1-sol`. OPA denies it:

   ```bash
   curl -si http://localhost:4000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $(cat ../lib/jwt/tokens/bob.jwt)" \
     -d '{"model":"openai/gpt-6.1-sol","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'
   ```

   Expected output:

   ```
   HTTP/1.1 403 Forbidden
   ...

   denied by OPA: team marketing may not use model openai/gpt-6.1-sol
   ```

   Run the same request with `alice.jwt` and you get `HTTP/1.1 200 OK`.

</details>

## Step 5: Change the policy

The policy lives in a file. Editing the file changes who is allowed, and the gateway keeps running as it is.

1. Open `setup/opa/policy.rego` in a text editor.
2. Find the line `marketing_models := {"openai/gpt-6-luna"}` and change it to:

   ```rego
   marketing_models := {"openai/gpt-6-luna", "openai/gpt-6.1-sol"}
   ```

3. Save the file. OPA reloads it within a few seconds. If the request below is still denied after 10 seconds, run `docker compose restart opa` from the `setup/` folder.
4. In the Chat Playground, paste bob's token in **Raw API key**, set **Specific model** to `gpt-6.1-sol`, and click **Send**.

Bob now gets a reply.

## What the UI wrote

In the sidebar, scroll down to **Tools** and click **Raw Configuration**. The UI added an `extAuthz` policy to the `llm` section:

```yaml
llm:
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

1. In `setup/opa/policy.rego`, change the `marketing_models` line back to `marketing_models := {"openai/gpt-6-luna"}` and save the file.
2. In the sidebar, click **Policies**.
3. Click the **External authz** card.
4. Click **Delete policy** (the trash icon at the top of the panel).

   ![External authz panel with the Delete policy button](../../images/llm/opa-authorization/06-delete-policy.png)

5. Click **Delete policy** to confirm. The card shows **disabled**.
6. From the `setup/` folder, stop OPA:

   ```bash
   docker compose --profile opa stop opa
   ```

7. In the sidebar, click **Models**.
8. In the `openai/*` row, click the trash icon, then click **Delete model**.

The gateway is back to the state [001](../../001-set-up-standalone-agentgateway.md) left it in.

`setup/opa/policy.rego` also has rules for MCP tool calls, below the rules this lab shows. To protect your MCP servers with the same OPA service, see [Decide Who Can Call Which MCP Tool with Open Policy Agent](../mcp/mcp-opa-authorization.md).
