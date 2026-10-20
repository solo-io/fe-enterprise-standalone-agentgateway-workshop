# Connect Anthropic Next to OpenAI

## Before you start

- Complete [Connect LLM Providers](../llm/connect-llm-providers.md). The gateway has the `openai/*` model.
- Put your Anthropic API key in `setup/.env` as `ANTHROPIC_API_KEY`, then restart the gateway so it reads the key: from the `setup/` folder, run `env UID=$(id -u) GID=$(id -g) docker compose up -d`. You can get a key from the [Anthropic Console](https://console.anthropic.com/).

## What you'll do

- Add Anthropic as a shared provider
- Add an `anthropic/*` model next to `openai/*`
- Ask GPT and Claude the same question in the Chat Playground
- Call Claude in OpenAI format and in Anthropic format
- Compare the two providers in Logs and Analytics

## Why this matters

Your applications already send OpenAI-format requests to port `4000`. With a second provider on the same gateway, a client switches to Claude by changing the model name. The gateway translates the request, adds the Anthropic key, and records tokens and cost for both providers in one place.

## Step 1: Add the Anthropic provider

A shared provider holds a credential once. Every model that references it uses that credential.

1. In the sidebar, click **Providers**.
2. Click **Add provider**.

   ![Providers page with no shared providers](../../images/llm/connect-anthropic/01-providers-empty.png)

3. In **Provider name**, enter `anthropic`.
4. In **Provider**, select **Anthropic**.
5. Next to **Provider API key**, click **Env var** and enter `ANTHROPIC_API_KEY`.
6. Click **Save provider**.

   ![Add provider panel for Anthropic](../../images/llm/connect-anthropic/02-add-provider.png)

## Step 2: Add the Claude model

1. In the sidebar, click **Models**.
2. Click **Add model**.
3. In **Provider**, select **anthropic** (marked **configured**). This is the shared provider from Step 1. The UI fills **Incoming model match** with `anthropic/*`.
4. Under **Outgoing model**, click **Strip anthropic/**.
5. Click **Save model**.

   ![Add model panel for anthropic/*](../../images/llm/connect-anthropic/03-add-model.png)

Like `openai/*`, the model matches any name that starts with `anthropic/`, for example `anthropic/claude-haiku-5-5`, and **Strip anthropic/** sends `claude-haiku-5-5` to Anthropic.

The Models page now lists both models:

![Models page with openai/* and anthropic/*](../../images/llm/connect-anthropic/04-models.png)

## Step 3: Ask GPT and Claude the same question

1. In the sidebar, click **Chat Playground**.
2. In **Model**, select **openai/\***. In **Specific model**, enter `gpt-6-luna`.
3. In **User message**, enter `Reply with the single word: pong` and click **Send**.
4. In **Model**, select **anthropic/\***. In **Specific model**, enter `claude-haiku-5-5`.
5. In **User message**, enter `Reply with the single word: pong` and click **Send**.

Both replies are in the same conversation. The chips under each reply name the provider (`openai` or `anthropic`) and the model:

![Chat Playground with replies from gpt-6-luna and claude-haiku-5-5](../../images/llm/connect-anthropic/05-playground-claude.png)

## Step 4: Call Claude in OpenAI format

Send the same OpenAI-format request twice. Only the model name changes.

```bash
curl -s http://localhost:4000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'
```

```bash
curl -s http://localhost:4000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"anthropic/claude-haiku-5-5","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'
```

Expected output, for the second command:

```
{"model":"claude-haiku-5-5",...,"usage":{"prompt_tokens":18,"completion_tokens":4,...},"choices":[{"message":{"content":"pong","role":"assistant"},"index":0,"finish_reason":"stop"}],"id":"msg_...","object":"chat.completion",...}
```

Both answers come back as `chat.completion` objects. The gateway translated the second request to the Anthropic Messages API and translated Claude's answer back to OpenAI format. The `msg_` ID shows that Anthropic answered.

## Step 5: Call Claude in Anthropic format

Clients built for Anthropic, such as the Anthropic SDKs and Claude Code, send the Anthropic Messages API format to `/v1/messages`. The gateway accepts that format too:

```bash
curl -s http://localhost:4000/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"anthropic/claude-haiku-5-5","max_tokens":1024,"messages":[{"role":"user","content":"Reply with the single word: pong"}]}'
```

Expected output:

```
{"id":"msg_...","type":"message","role":"assistant","model":"claude-haiku-5-5",...,"content":[{"text":"pong","type":"text"}],...}
```

Neither request carries an Anthropic key. The gateway adds it from the `anthropic` provider.

## Check it

1. In the sidebar, click **Logs**.
2. Find the rows for `anthropic/claude-haiku-5-5` and `openai/gpt-6-luna`, all with status `200`. Each row shows the provider, the model the provider received, the tokens and the cost.

![Logs page with requests to both providers](../../images/llm/connect-anthropic/06-logs.png)

You may also see a row named `unknown model`. That is the browser's preflight check from the Chat Playground; you can ignore it.

3. In the sidebar, click **Analytics**.
4. In **Group by**, select **Provider**, then click outside the list to close it.

The chart splits the tokens between `anthropic` and `openai`. The line above the chart shows the total cost, tokens and calls for both providers:

![Analytics with tokens grouped by provider](../../images/llm/connect-anthropic/07-analytics.png)

## What the UI wrote

In the sidebar, scroll down to **Tools** and click **Raw Configuration**. The UI added this to the `llm` section:

```yaml
llm:
  providers:
    - name: anthropic
      provider: anthropic
      params:
        apiKey: $ANTHROPIC_API_KEY
  models:
    - name: anthropic/*
      provider:
        reference: anthropic
      transformation:
        model: llmRequest.model.stripPrefix("anthropic/")
```

The model points at the provider with `reference`. A second Claude model, for example one with its own policies, can reference the same provider and use the same key.

## Next

To run Claude Code through the gateway with this model, go to [Connect Coding Agents](connect-coding-agents.md) before you clean up.

## Clean up

1. In the sidebar, click **Models**.
2. In the `anthropic/*` row, click **Delete model**, then click **Delete model** in the dialog.
3. In the sidebar, click **Providers**.
4. In the `anthropic` row, click **Delete provider**, then click **Delete provider** in the dialog.
