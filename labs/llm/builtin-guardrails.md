# Block and Mask Sensitive Data with Built-in Guardrails

## Before you start

- Complete [Connect LLM Providers](../llm/connect-llm-providers.md). The gateway has the `openai/*` model.

## What you'll do

- Add a request guard that blocks credit card numbers and US Social Security numbers
- Add a request guard with your own regular expression that blocks AWS access keys
- Add a response guard that hides email addresses in the model's reply
- Send prompts from the Chat Playground and see each guard work

## Why this matters

Users paste sensitive data into prompts, and models can repeat sensitive data in replies. Guardrails check this traffic inside the gateway, before a prompt reaches OpenAI and before a reply reaches the user. A blocked request never leaves the gateway, so the provider never sees the data and you pay nothing for it.

## Step 1: Block credit card numbers and SSNs

1. In the sidebar, click **Guardrails**.
2. Under **Request guards**, click **Add guard**.

   ![Guardrails page with no guards](../../images/llm/builtin-guardrails/01-guardrails-empty.png)

3. In **Guard type**, select **Built-in detectors**.
4. Leave **Action** on **Reject request**.
5. Under **Built-in detectors**, click **Email** to turn it off. Then click **Credit card** and **SSN** to turn them on.
6. In **Rejection status**, enter `422`.
7. In **Rejection body**, enter `Request blocked: credit card or SSN detected.`
8. Click **Add guard**.

   ![Add request guard panel with the Credit card and SSN detectors on](../../images/llm/builtin-guardrails/02-builtin-detectors.png)

The selected detectors are highlighted. You turn off **Email** here because Step 3 lets email addresses through the request and hides them in the reply instead.

## Step 2: Block AWS access keys with your own pattern

1. Under **Request guards**, click **Add guard**.
2. In **Guard type**, select **Custom regex**.
3. Leave **Action** on **Reject request**.
4. Under **Custom regex patterns**, enter `AKIA[0-9A-Z]{16}`.
5. Leave **Rejection status** empty. The gateway uses `403`.
6. In **Rejection body**, enter `Request blocked: AWS access key detected.`
7. Click **Add guard**.

   ![Add request guard panel with the AWS access key pattern](../../images/llm/builtin-guardrails/03-custom-regex.png)

The pattern matches AWS access key IDs: `AKIA` followed by 16 capital letters or digits. Click **Add pattern** if you want one guard to check more patterns.

## Step 3: Hide email addresses in replies

1. Under **Response guards**, click **Add guard**.

   ![Guardrails page with two request guards](../../images/llm/builtin-guardrails/04-add-response-guard.png)

2. In **Guard type**, select **Built-in detectors**.
3. In **Action**, select **Mask matched text**.
4. Leave **Email** on.
5. Click **Add guard**.

   ![Add response guard panel set to mask email addresses](../../images/llm/builtin-guardrails/05-mask-email.png)

## Step 4: Save the guardrails

The guards are not active until you save them.

1. Click **Save guardrails**.

   ![Guardrails page with three guards and the Save guardrails button](../../images/llm/builtin-guardrails/06-save-guardrails.png)

The gateway reloads its configuration within a second or two.

## Check it

### A credit card number is blocked

1. In the sidebar, click **Chat Playground**.
2. In **Model**, select **openai/\***.
3. In **Specific model**, enter `gpt-4o-mini`.
4. In **User message**, enter `My card number is 4111 1111 1111 1111. Is it valid?` and click **Send**.

The playground shows **Playground request failed** with your rejection body:

![Chat Playground with the request blocked by the credit card detector](../../images/llm/builtin-guardrails/07-blocked-card.png)

If the reply arrives instead, wait 2 seconds, reload the page and send the prompt again.

### An AWS access key is blocked

1. Reload the page.
2. Select the model again as in the previous check.
3. In **User message**, enter `Here is my AWS key AKIAIOSFODNN7EXAMPLE. Is the format right?` and click **Send**.

The playground shows **Request blocked: AWS access key detected.**

![Chat Playground with the request blocked by the AWS key pattern](../../images/llm/builtin-guardrails/08-blocked-aws-key.png)

### An email address in the reply is masked

1. In **User message**, enter `Repeat this sentence exactly, with no other text: Contact jane.doe@example.com today.` and click **Send**.

The request passes, because no request guard checks for email addresses. The model repeats the sentence, and the response guard replaces the address with `<EMAIL_ADDRESS>`:

![Chat Playground reply with the email address replaced by EMAIL_ADDRESS](../../images/llm/builtin-guardrails/09-masked-email.png)

The model decides what it writes. If the reply does not contain the email address, send the prompt again.

<details>
<summary>Optional: check with curl</summary>

```bash
curl -s -w '\nHTTP %{http_code}\n' http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{ "role": "user", "content": "My card number is 4111 1111 1111 1111. Is it valid?" }]
  }'
```

Expected output:

```
Request blocked: credit card or SSN detected.
HTTP 422
```

```bash
curl -s -w '\nHTTP %{http_code}\n' http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{ "role": "user", "content": "Here is my AWS key AKIAIOSFODNN7EXAMPLE. Is the format right?" }]
  }'
```

Expected output:

```
Request blocked: AWS access key detected.
HTTP 403
```

</details>

## What the UI wrote

In the sidebar, scroll down to **Tools** and click **Raw Configuration**. The UI added this to `llm.policies`:

```yaml
llm:
  policies:
    guardrails:
      request:
        - regex:
            action: reject
            rules:
              - builtin: creditCard
              - builtin: ssn
          rejection:
            status: 422
            body: 'Request blocked: credit card or SSN detected.'
        - regex:
            action: reject
            rules:
              - pattern: AKIA[0-9A-Z]{16}
          rejection:
            body: 'Request blocked: AWS access key detected.'
      response:
        - regex:
            action: mask
            rules:
              - builtin: email
```

## Clean up

1. In the sidebar, click **Guardrails**.
2. Next to the **LLM Guardrails** title, click **Remove**.

   ![Guardrails page with the Remove button next to the title](../../images/llm/builtin-guardrails/10-remove-all.png)

3. Click **Remove guardrails** to confirm.

   ![Remove all LLM guardrails confirmation](../../images/llm/builtin-guardrails/11-confirm-remove.png)

Both lists show **No guards configured.** The change is saved right away. Logs keep the requests from this lab.
