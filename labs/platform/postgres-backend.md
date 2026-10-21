# Store Logs and UI Changes in Postgres

## Before you start

- Complete [001: Set Up Standalone Agentgateway](../../001-set-up-standalone-agentgateway.md).
- Start Postgres. From the `setup/` folder, run:

  ```bash
  env UID=$(id -u) GID=$(id -g) docker compose --profile postgres up -d --wait postgres
  ```

  The `postgres` profile has two services. This command starts only `postgres`, a Postgres 17 database named `agentgateway` with the user and password `agentgateway`. You start the second service, `agentgateway-2`, in Step 4.

  To check that Postgres is ready, run:

  ```bash
  docker compose exec postgres pg_isready -U agentgateway
  ```

  Expected output:

  ```
  /var/run/postgresql:5432 - accepting connections
  ```

## What you'll do

- Point the gateway at Postgres instead of its SQLite file
- Turn on hybrid storage, so the models and keys you add in the UI go to Postgres
- Start a second gateway on the same database and see it serve the same model
- Find the requests of both gateways in one log
- Delete the model on one gateway and see it disappear from the other

## Why this matters

By default, the gateway keeps its request logs in a SQLite file, `setup/data.db`, and writes the changes you make in the UI to `config.yaml`. Only that one gateway can read them. If you run two or more gateways, for more capacity or to keep traffic flowing when one stops, each one has its own logs, models and keys. With Postgres and hybrid storage, all the gateways read the same models and keys and write to the same log. A change you make in one gateway's UI reaches the others in about a second.

## Step 1: Point the gateway at Postgres

1. In the sidebar, scroll down to **Tools** and click **Raw Configuration**.
2. Select lines 3 and 4, `database:` and `url: sqlite:///config/data.db`: click at the left edge of line 3, before the spaces, and drag to the start of line 5.

   ![Raw Configuration with lines 3 and 4 selected](../../images/platform/postgres-backend/01-raw-config-database.png)

3. Paste this block over the selected lines:

   ```yaml
     database:
       url: postgres://agentgateway:agentgateway@postgres:5432/agentgateway
     storage:
       mode: hybrid
   ```

4. Check that `storage:` is on line 5, in line with `database:`, and `modelCatalog:` is on line 7. Click **Save**.

   ![Raw Configuration with the Postgres database and hybrid storage](../../images/platform/postgres-backend/02-raw-config-postgres.png)

`database.url` tells the gateway where to keep request logs and budget usage. A URL that starts with `postgres://` or `postgresql://` uses Postgres. Any other value is a SQLite file. `storage.mode: hybrid` keeps `config.yaml` as the starting point and saves the changes you make in the UI to the same database.

The gateway reads `database` and `storage` only when it starts. Until you restart it, it keeps using SQLite.

## Step 2: Restart the gateway

1. From the `setup/` folder, run:

   ```bash
   docker compose restart agentgateway
   ```

2. Reload the UI and open **Raw Configuration** again.

   ![Raw Configuration in hybrid mode](../../images/platform/postgres-backend/03-raw-config-hybrid.png)

3. Click the **Database** tab.

   ![Raw Configuration Database tab with no resources](../../images/platform/postgres-backend/04-raw-config-database-tab.png)

Raw Configuration now has two tabs, **File** and **Database**. On **File**, the **Save** button stays off when you edit: in hybrid mode the UI saves your changes to Postgres, and `config.yaml` changes only when you edit it outside the UI.

The gateway created its tables in Postgres when it started. The **Database** tab lists the changes the UI stored there, and shows **No database resources** until you add something. **Logs** starts empty: the logs from before the restart stay in `setup/data.db`.

## Step 3: Add a model and send a request

1. In the sidebar, click **Models**.
2. Click **Add model**.

   ![Models page with no models yet](../../images/llm/connect-llm-providers/01-models-empty.png)

3. In **Provider**, select **OpenAI**. The UI fills **Incoming model match** with `openai/*`.
4. Next to **Provider API key**, click **Env var** and enter `OPENAI_API_KEY`.
5. Under **Outgoing model**, click **Strip openai/**.
6. Click **Save model**.

   ![Add model panel filled in for OpenAI](../../images/llm/connect-llm-providers/02-add-openai-model.png)

The `openai/*` row shows **Database** as its source. `config.yaml` has no `models:` list: the model is in Postgres.

![Models page with openai/* from the database](../../images/platform/postgres-backend/05-models-database.png)

7. In the sidebar, click **Chat Playground**.
8. In **Model**, select **openai/\***. In **Specific model**, enter `gpt-6-luna`.
9. In **User message**, enter `Reply with exactly: PONG-1` and click **Send**.

   ![Chat Playground with the PONG-1 reply](../../images/platform/postgres-backend/06-chat.png)

10. In the sidebar, click **Logs**.

The request to `openai/gpt-6-luna` is in the list, with status `200`. The **Logs** page reads it from Postgres.

![Logs with the PONG-1 request](../../images/platform/postgres-backend/07-logs.png)

## Step 4: Start a second gateway

`setup/postgres/gateway-2.yaml` is the config of a second gateway. It has the same `database` and `storage` settings as the first. It runs in the first gateway's network on other ports: its UI is on `15100` and its LLM traffic on `4100`. Restarting the first gateway cuts the second one off from the network. Stop the second gateway before you restart the first.

1. From the `setup/` folder, run:

   ```bash
   env UID=$(id -u) GID=$(id -g) docker compose --profile postgres up -d agentgateway-2
   ```

2. Open `http://localhost:15100/ui` and click **Models** in the sidebar.

The second gateway lists `openai/*` with the source **Database**. You added this model on the first gateway.

![Second gateway's Models page with openai/*](../../images/platform/postgres-backend/08-gateway-2-models.png)

## Check it

1. Send a request to the second gateway on port `4100`:

   ```bash
   curl -s http://localhost:4100/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model": "openai/gpt-6-luna", "messages": [{"role": "user", "content": "Reply with exactly: PONG-2"}]}'
   ```

   Expected output:

   ```
   {"model":"gpt-6-luna",...,"choices":[{"index":0,"message":{"role":"assistant","content":"PONG-2",...}...}]...}
   ```

2. Open `http://localhost:15000/ui`, the first gateway, and click **Logs**.

The list has two `openai/gpt-6-luna` requests: the newer one is `PONG-2` from the second gateway, the older one is `PONG-1` from the first. The `unknown model` row is the browser's preflight request from the Chat Playground.

![Logs of the first gateway with both requests](../../images/platform/postgres-backend/09-logs-both.png)

<details>
<summary>Optional: look at the tables in Postgres</summary>

The request logs:

```bash
docker compose exec postgres psql -U agentgateway -c "select completed_at, gen_ai_request_model, input_tokens, output_tokens from request_logs where gen_ai_request_model is not null order by completed_at"
```

Expected output (your times and counts differ):

```
         completed_at          | gen_ai_request_model | input_tokens | output_tokens
-------------------------------+----------------------+--------------+---------------
 2026-10-21 22:48:43.171862+00 | gpt-6-luna           |           24 |             7
 2026-10-21 22:48:47.489963+00 | gpt-6-luna           |           14 |             7
(2 rows)
```

The changes you made in the UI, one row for each model, key or policy:

```bash
docker compose exec postgres psql -U agentgateway -c "select kind, id, revision from agw_config_resources"
```

Expected output (your ID differs):

```
   kind    |                  id                  | revision
-----------+--------------------------------------+----------
 llm.model | c3efc30d-78d2-41c4-8477-e48d2137763b |        1
(1 row)
```

</details>

Now delete the model on the second gateway:

3. Open `http://localhost:15100/ui`, the second gateway, and click **Models**.
4. In the `openai/*` row, click the trash icon, then click **Delete model**.

   ![Second gateway's Models page with the delete icon](../../images/platform/postgres-backend/10-gateway-2-delete.png)

5. Open `http://localhost:15000/ui/llm/models`, the first gateway's Models page.

The first gateway has no models either. The second gateway deleted the model in Postgres, and the first gateway read the change.

![First gateway's Models page with no models](../../images/platform/postgres-backend/11-models-empty.png)

## What the UI wrote

In the sidebar, scroll down to **Tools** and click **Raw Configuration**. On the **File** tab, `config.yaml` has the two settings from Step 1. The UI sorted the keys when it saved and put `storage` below `modelCatalog`:

```yaml
config:
  adminAddr: 0.0.0.0:15000
  database:
    url: postgres://agentgateway:agentgateway@postgres:5432/agentgateway
  modelCatalog:
    - file: /config/base-costs.json
  storage:
    mode: hybrid
...
```

The file has no `models:` list. The `openai/*` model was in Postgres, on the **Database** tab, until you deleted it in Check it.

## Clean up

1. Stop the second gateway. From the `setup/` folder, run:

   ```bash
   docker compose --profile postgres stop agentgateway-2
   ```

2. Open `setup/config.yaml` in a text editor. Raw Configuration cannot save it in hybrid mode.
3. Under `database:`, replace the `url:` line:

   ```yaml
       url: postgres://agentgateway:agentgateway@postgres:5432/agentgateway
   ```

   with:

   ```yaml
       url: sqlite:///config/data.db
   ```

4. Delete these two lines:

   ```yaml
     storage:
       mode: hybrid
   ```

5. Save the file, then restart the gateway:

   ```bash
   docker compose restart agentgateway
   ```

6. Remove Postgres, the second gateway and the Postgres data:

   ```bash
   docker compose --profile postgres rm -sfv postgres agentgateway-2
   ```

The gateway is back to the state [001](../../001-set-up-standalone-agentgateway.md) left it in. The logs from before this lab are still in `setup/data.db`. The logs from this lab were in Postgres and are gone.
