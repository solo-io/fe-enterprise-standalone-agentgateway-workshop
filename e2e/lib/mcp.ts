// Minimal MCP Streamable HTTP client for assertions that do not go through the UI.

type Rpc = { status: number; body: any };

function parseBody(text: string): any {
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  const raw = data.length ? data[data.length - 1] : text;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: text };
  }
}

export async function mcpConnect(url: string, token?: string) {
  let sessionId = '';
  let nextId = 1;

  async function rpc(method: string, params?: object, notify = false): Promise<Rpc> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const msg: any = { jsonrpc: '2.0', method };
    if (params) msg.params = params;
    if (!notify) msg.id = nextId++;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(msg) });
    sessionId = res.headers.get('mcp-session-id') ?? sessionId;
    const text = await res.text();
    return { status: res.status, body: text ? parseBody(text) : undefined };
  }

  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'workshop-e2e', version: '0' },
  });
  if (init.status === 200) await rpc('notifications/initialized', undefined, true);

  return {
    /** HTTP status of the initialize call. */
    status: init.status,
    async tools(): Promise<string[]> {
      const r = await rpc('tools/list', {});
      return (r.body?.result?.tools ?? []).map((t: any) => t.name);
    },
    async call(name: string, args: object): Promise<{ status: number; isError: boolean; text: string }> {
      const r = await rpc('tools/call', { name, arguments: args });
      const result = r.body?.result;
      const text = result?.content?.map((c: any) => c.text ?? '').join('\n') ?? JSON.stringify(r.body?.error ?? r.body);
      return { status: r.status, isError: !!(result?.isError || r.body?.error), text };
    },
  };
}
