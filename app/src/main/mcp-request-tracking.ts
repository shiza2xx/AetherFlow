import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/** Long-lived Streamable HTTP GET SSE subscriptions are not active MCP operations. */
export function isActiveMcpOperationRequest(
  request: Pick<IncomingMessage, 'method' | 'url' | 'headers'>,
  token: string,
): boolean {
  return request.method === 'POST'
    && (request.url || '').split('?')[0] === '/mcp'
    && request.headers.authorization === `Bearer ${token}`;
}

/** Track each authenticated MCP POST until its response finishes or closes, once. */
export function trackMcpOperationRequests(
  server: Server,
  token: string,
  workspaceChanging: () => boolean,
  onCountChange: (count: number) => void,
): () => number {
  let active = 0;
  const onRequest = (request: IncomingMessage, response: ServerResponse) => {
    if (!isActiveMcpOperationRequest(request, token) || workspaceChanging()) return;
    active += 1;
    onCountChange(active);
    let counted = true;
    const done = () => {
      if (!counted) return;
      counted = false;
      active = Math.max(0, active - 1);
      onCountChange(active);
    };
    response.once('finish', done);
    response.once('close', done);
  };
  server.prependListener('request', onRequest);
  return () => active;
}
