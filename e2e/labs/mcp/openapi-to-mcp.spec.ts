// labs/mcp/openapi-to-mcp.md
// @fixture mcp-ready
import { expect, test } from '@playwright/test';
import { lab, sh } from '../../lib/lab';

const { go, shot, save } = lab('mcp', 'openapi-to-mcp');

test.describe.configure({ mode: 'serial' });

// The schema block in the lab, pasted as the reader pastes it.
const SCHEMA = `{
  "openapi": "3.0.0",
  "info": {
    "title": "Open-Meteo Forecast API",
    "version": "1.0.0",
    "description": "Free weather forecast API. No API key required."
  },
  "servers": [
    { "url": "/" }
  ],
  "paths": {
    "/v1/forecast": {
      "get": {
        "operationId": "getWeatherForecast",
        "summary": "Get the weather forecast for a geographic location",
        "description": "Returns current, hourly, and/or daily weather variables for a latitude/longitude. Use the 'current' parameter for an instantaneous snapshot.",
        "parameters": [
          {
            "name": "latitude",
            "in": "query",
            "required": true,
            "description": "Latitude of the location in decimal degrees (e.g. 51.5072 for London).",
            "schema": { "type": "number" }
          },
          {
            "name": "longitude",
            "in": "query",
            "required": true,
            "description": "Longitude of the location in decimal degrees (e.g. -0.1276 for London).",
            "schema": { "type": "number" }
          },
          {
            "name": "current",
            "in": "query",
            "required": false,
            "description": "Comma-separated list of current weather variables, e.g. 'temperature_2m,wind_speed_10m,relative_humidity_2m'.",
            "schema": { "type": "string" }
          },
          {
            "name": "hourly",
            "in": "query",
            "required": false,
            "description": "Comma-separated list of hourly weather variables, e.g. 'temperature_2m,precipitation'.",
            "schema": { "type": "string" }
          },
          {
            "name": "daily",
            "in": "query",
            "required": false,
            "description": "Comma-separated list of daily weather variables, e.g. 'temperature_2m_max,temperature_2m_min'.",
            "schema": { "type": "string" }
          },
          {
            "name": "temperature_unit",
            "in": "query",
            "required": false,
            "description": "Unit for temperature values.",
            "schema": { "type": "string", "enum": ["celsius", "fahrenheit"] }
          },
          {
            "name": "timezone",
            "in": "query",
            "required": false,
            "description": "Timezone for daily/hourly timestamps. Use 'auto' to resolve from the coordinates.",
            "schema": { "type": "string" }
          },
          {
            "name": "forecast_days",
            "in": "query",
            "required": false,
            "description": "Number of forecast days to return (0-16).",
            "schema": { "type": "integer" }
          }
        ],
        "responses": {
          "200": {
            "description": "Weather forecast data"
          }
        }
      }
    }
  }
}`;

const QUERY = '{"latitude": 51.5072, "longitude": -0.1276, "hourly": "temperature_2m", "forecast_days": 1}';

test('add the Open-Meteo API as an MCP server', async ({ page }) => {
  await go(page, '/mcp/servers');
  await page.getByRole('button', { name: 'Add server' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Server name' }).fill('open-meteo');
  await d.getByRole('radio', { name: 'OpenAPI' }).click();
  await d.getByRole('textbox', { name: /^URL/ }).fill('https://api.open-meteo.com');
  await shot(page, '01-add-openapi-server', d.getByRole('radio', { name: 'Inline' }));
  await d.getByRole('radio', { name: 'Inline' }).click();
  // The schema editor is a code editor: paste like the reader does, so brackets are not auto-closed.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), SCHEMA);
  await d.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(d.locator('.monaco-editor')).toContainText('Weather forecast data');
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(d.locator('.monaco-editor')).toContainText('Open-Meteo');
  await shot(page, '02-paste-schema', d.getByRole('button', { name: 'Save server' }));
  await save(page, 'Save server');
  const row = page.locator('main').getByRole('row', { name: /^open-meteo\b/ });
  await expect(row).toContainText('OpenAPI');
  await expect(row).toContainText('ready', { timeout: 30_000 });
  await shot(page, '03-server-ready');
});

test('call the generated tool', async ({ page }) => {
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Initialize' }).click();
  await expect(main.getByText('4 tools discovered')).toBeVisible({ timeout: 30_000 });
  await main.getByRole('combobox', { name: 'Tool' }).click();
  await page.getByRole('option', { name: /^open-meteo_getWeatherForecast/ }).click();
  // query is a JSON code editor.
  const query = main.locator('.monaco-editor').first();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), QUERY);
  await query.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(query).toContainText('latitude');
  const call = main.getByRole('button', { name: 'Call tool' });
  await shot(page, '04-call-tool', call);
  await call.click();
  // Check inside the Tool output only: the reader's own query editor also contains "temperature_2m".
  // Open-Meteo's response has an "hourly_units" object and an "hourly" object with a time array
  // and a temperature_2m array; the query, the tool schema and its description do not.
  const toolOutput = main.locator('.mcp-text-output');
  const out = toolOutput.getByText(/"hourly_units"/).first();
  await expect(out).toBeVisible({ timeout: 30_000 });
  await expect(toolOutput.first()).toContainText(/"hourly":\s*\{\s*"time":\s*\[/);
  await expect(toolOutput.first()).toContainText(/"temperature_2m":\s*\[/);
  await shot(page, '05-tool-result', out);
});

const CURL = `SESSION=$(curl -s -D - -o /dev/null http://localhost:4001/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \\
  | grep -i '^mcp-session-id:' | awk '{print $2}' | tr -d '\\r')
curl -s http://localhost:4001/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Mcp-Session-Id: $SESSION" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"open-meteo_getWeatherForecast","arguments":{"query":{"latitude":51.5072,"longitude":-0.1276,"current":"temperature_2m"}}}}'`;

test('optional curl check', async () => {
  const r = sh(CURL);
  console.log(r.stdout.slice(0, 600));
  expect(r.stdout).toContain('current_units');
});

test('clean up', async ({ page }) => {
  await go(page, '/mcp/servers');
  const row = page.locator('main').getByRole('row', { name: /^open-meteo\b/ });
  await row.getByRole('button', { name: 'Delete server' }).click();
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Delete server' });
  await shot(page, '06-delete-server', confirm);
  await confirm.click();
  await expect(row).toBeHidden();
});
