# Require a JWT and Allow Only One Team

## Before you start

- Complete [Connect LLM Providers](../llm/connect-llm-providers.md). The gateway has the `openai/*` model.
- The workshop ships a signing key and two test users in `lib/jwt/`. You paste the public key and the tokens from this lab, or from the files named below.

| User | Token file | `team` claim |
|---|---|---|
| alice | `lib/jwt/tokens/alice.jwt` | `platform` |
| bob | `lib/jwt/tokens/bob.jwt` | `marketing` |

Both tokens have issuer `solo-workshop` and audience `agentgateway`, and expire in 2036.

## What you'll do

- Require a valid JWT on every LLM request
- See a request without a token fail, and alice's request succeed
- Add an authorization rule that allows only the `platform` team
- See bob's request fail and alice's request succeed

## Why this matters

Your company already signs users in with an identity provider such as Okta, Entra ID or Keycloak. That provider issues JSON Web Tokens (JWTs). The gateway can check each token's signature and claims, so only signed-in users reach your LLMs. An authorization rule then reads the claims, for example the user's team, and decides who gets access.

## Step 1: Turn on JWT auth

1. In the sidebar, click **Policies**.
2. Click the **JWT auth** card.

   ![LLM Policies page with the JWT auth card](../../images/llm/jwt-auth-and-authorization/01-policies-jwt-card.png)

3. Under **Validation mode**, click **Strict**. Strict rejects every request that does not carry a valid token.
4. Under **JWKS source**, click **Inline JSON**.
5. Click in **Inline JWKS**, select all the text, and paste the contents of `lib/jwt/public-jwks.json`:

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

   ![JWT auth panel with the inline JWKS pasted](../../images/llm/jwt-auth-and-authorization/02-jwt-signing-keys.png)

6. In **Issuer**, enter `solo-workshop`.
7. Under **Audiences**, enter `agentgateway` and click **Add**.
8. Click **Save policy**.

   ![JWT auth panel with issuer and audience filled in](../../images/llm/jwt-auth-and-authorization/03-jwt-token-validation.png)

The JWKS (JSON Web Key Set) is the public half of the key that signed the tokens. The gateway uses it to check that a token is real. **Issuer** and **Audiences** make the gateway accept only tokens with `iss: solo-workshop` and `aud: agentgateway`.

## Step 2: Send a request without a token, then with alice's token

1. In the sidebar, click **Chat Playground**.
2. In **Model**, select **openai/\***.
3. In **Specific model**, enter `gpt-4o-mini`.
4. Leave **Raw API key** empty.
5. In **User message**, enter `Reply with the single word: pong` and click **Send**.

The gateway rejects the request with HTTP status `401`. The playground shows **Playground request failed** with **authentication failure: no bearer token found**:

![Chat Playground showing the authentication failure](../../images/llm/jwt-auth-and-authorization/04-playground-no-token.png)

6. In **Raw API key**, paste alice's token:

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYWxpY2UiLCJ0ZWFtIjoicGxhdGZvcm0iLCJpYXQiOjE3OTIxODUwMzAsImV4cCI6MjA4Mjc1ODQwMH0.aTQQX7hEmLLAtzewO2RijvGtIascY2iKF3i4T9YL4IYXf39iPLs_WzLRwR_nCVedA29FtEux3lgUbVm_7G-pvENFs2WZ8oXqq92faPQVZacT7HOs-Jr_xrEH94LQMwge9Wz3wbjTVlED6b6ttXK2SIKQfJPC5WSMC1DgpwjfGM8PBABsbt3eauLViL_FRcrDzgGz5OAUJSN_XuqyN-6xo05WVdNmDK7wfNs2dboxCLgGz7qQMSfg3IbJzviRbS2lKP3_nQTwXNqJVB5-_2hOHytmyg4AMWaAEk6a49O2xNq9zMBoUQM5stzZ7CpgcKe1zLgvGB9HyNDU01pNod6DkA
   ```

7. In **User message**, enter `Reply with the single word: pong` and click **Send**.

The playground sends the token in the `Authorization: Bearer` header. The gateway accepts it, and the reply comes back with the status **OK**:

![Chat Playground with a reply for alice](../../images/llm/jwt-auth-and-authorization/05-playground-alice.png)

## Step 3: Allow only the platform team

1. In the sidebar, click **Policies**.
2. Click the **Authorization** card.

   ![LLM Policies page with the Authorization card](../../images/llm/jwt-auth-and-authorization/06-policies-authz-card.png)

3. Click **Add rule**. The new rule has the effect **Allow**.
4. Click in the rule's expression box, select all the text, and enter:

   ```
   jwt.team == "platform"
   ```

5. Click **Save policy**.

   ![Authorization panel with the rule jwt.team == "platform"](../../images/llm/jwt-auth-and-authorization/07-authz-rule.png)

The rule is a CEL expression. `jwt` holds the claims of the token that the JWT auth policy checked, so `jwt.team` is the `team` claim. When a policy has allow rules, the gateway rejects every request that matches none of them.

### Optional: test the rule in the CEL Playground

You can try an expression before you save it.

1. In the sidebar, under **Tools**, click **CEL Playground**.
2. In **Expression**, select all the text and enter `jwt.team == "platform"`.
3. In **Request context YAML**, select all the text and enter:

   ```yaml
   jwt:
     sub: alice
     team: platform
   ```

4. Click **Evaluate**. **Result** shows `true`.

   ![CEL Playground with the result true](../../images/llm/jwt-auth-and-authorization/08-cel-playground.png)

5. Change `platform` to `marketing` in **Request context YAML** and click **Evaluate**. **Result** shows `false`.

## Check it

1. In the sidebar, click **Chat Playground**.
2. In **Model**, select **openai/\***, and in **Specific model**, enter `gpt-4o-mini`.
3. In **Raw API key**, paste bob's token:

   ```
   eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IndvcmtzaG9wLTEifQ.eyJpc3MiOiJzb2xvLXdvcmtzaG9wIiwiYXVkIjoiYWdlbnRnYXRld2F5Iiwic3ViIjoiYm9iIiwidGVhbSI6Im1hcmtldGluZyIsImlhdCI6MTc5MjE4NTAzMCwiZXhwIjoyMDgyNzU4NDAwfQ.icKID7IKO2O_p3M8PXxkoA6of3ARV_nQ8euLcdP0Mc7NpaxPVvs-alcGXul47Z5ZzXH4DtZIvJSOTbZvvDjOvz3Jt5bUriuydVRoxohAdBI7KasQt71nF8c00XC6SfRzqlI23D-pcE_Ya7d7LclRiTWvAtuANuHhX_Y4lcSZ2TNwdqbTVe3f-jpmi6mNprdqlL_ASOTwS0UephXs2ong9gxP_w546qcGtAZl48lvr2a7Fd2ESEKAWsMX3H7xPNDDmmth9CY3ZxxXA7QL2RL5Llpxt7azkTQ0AfSGVNfUgD9vnXMwsQpfNRrNySl3epne4HoUUg5LmwID36pvbX9rvg
   ```

4. In **User message**, enter `Reply with the single word: pong` and click **Send**.

bob's token is valid, but his team is `marketing`. The gateway rejects the request with HTTP status `403`, and the playground shows **authorization failed**:

![Chat Playground showing authorization failed for bob](../../images/llm/jwt-auth-and-authorization/09-playground-bob.png)

5. In **Raw API key**, paste alice's token again.
6. In **User message**, enter `Reply with the single word: pong` and click **Send**.

alice is on the `platform` team, so the reply comes back with the status **OK**:

![Chat Playground with a reply for alice](../../images/llm/jwt-auth-and-authorization/10-playground-alice-allowed.png)

If you send a request right after you save a policy and get an unexpected result, wait two seconds and send it again. The gateway needs about a second to load a new policy.

<details>
<summary>Optional: check with curl</summary>

Run these commands from the `setup` folder, so the shell can read the token files in `../lib/jwt/tokens/`.

Without a token:

```bash
curl -si http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'
```

Expected output:

```
HTTP/1.1 401 Unauthorized
...

authentication failure: no bearer token found
```

With bob's token:

```bash
curl -si http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat ../lib/jwt/tokens/bob.jwt)" \
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'
```

Expected output:

```
HTTP/1.1 403 Forbidden
...

authorization failed
```

With alice's token:

```bash
curl -si http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat ../lib/jwt/tokens/alice.jwt)" \
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'
```

Expected output:

```
HTTP/1.1 200 OK
...

{"model":"gpt-4o-mini-2024-07-18",...,"choices":[{"index":0,"message":{"role":"assistant","content":"Pong"},...}],...}
```

</details>

## What the UI wrote

In the sidebar, scroll down to **Tools** and click **Raw Configuration**. The UI added a `jwtAuth` policy and an `authorization` policy to the `llm` section:

```yaml
llm:
  policies:
    jwtAuth:
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
      jwtValidationOptions:
        requiredClaims:
        - exp
    authorization:
      rules:
      - allow: jwt.team == "platform"
```

`requiredClaims: [exp]` is the default: the gateway rejects tokens that have no expiry time.

## Clean up

1. In the sidebar, click **Policies**.
2. Click the **Authorization** card.
3. Click **Delete policy** (the trash icon at the top of the panel).

   ![Authorization panel with the Delete policy button](../../images/llm/jwt-auth-and-authorization/11-delete-policy.png)

4. Click **Delete policy** to confirm.

   ![Delete policy confirmation](../../images/llm/jwt-auth-and-authorization/12-confirm-delete.png)

5. Click the **JWT auth** card, click **Delete policy**, then click **Delete policy** to confirm.

Both cards show **disabled**, and requests without a token work again.
