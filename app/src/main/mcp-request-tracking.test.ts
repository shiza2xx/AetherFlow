import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trackMcpOperationRequests } from './mcp-request-tracking';

describe('authenticated MCP operation request tracking', () => {
  const token = 'isolated-test-token';
  let server: Server;
  let activeCount: number;
  let countHistory: number[];
  let transitionsReserved: boolean;
  let held: ServerResponse[];
  let port: number;

  beforeEach(async () => {
    activeCount = 0;
    countHistory = [];
    transitionsReserved = false;
    held = [];
    server = createServer((req, res) => {
      if (req.url?.split('?')[0] !== '/mcp') { res.writeHead(404).end(); return; }
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
      if (transitionsReserved) { res.writeHead(503).end('Workspace is changing.'); return; }
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/event-stream' }).flushHeaders(); return; }
      if (req.method === 'POST') { held.push(res); res.writeHead(200).flushHeaders(); return; }
      res.writeHead(405).end();
    });
    trackMcpOperationRequests(server, token, () => transitionsReserved, count => { activeCount = count; countHistory.push(count); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const response of held) response.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const send = (method: string, url: string, authorization = `Bearer ${token}`) => new Promise<{ req: ReturnType<typeof httpRequest>; res: IncomingMessage }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path: url, headers: authorization ? { authorization } : {} }, res => resolve({ req, res }));
    req.once('error', reject);
    req.end();
  });

  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(predicate()).toBe(true);
  };
  const consume = (res: IncomingMessage) => {
    if (res.readableEnded) return Promise.resolve();
    const ended = new Promise<void>(resolve => res.once('end', resolve));
    res.resume();
    return ended;
  };

  it('leaves an idle long-lived GET SSE subscription out of the busy count', async () => {
    const { req, res } = await send('GET', '/mcp');
    expect(res.statusCode).toBe(200);
    expect(activeCount).toBe(0);
    expect(activeCount === 0).toBe(true); // workspace transition predicate remains clear
    const closed = new Promise(resolve => res.once('close', resolve));
    req.destroy();
    await closed;
    expect(activeCount).toBe(0);
  });

  it('blocks workspace changes while an authenticated POST is open and decrements once on finish', async () => {
    const { res } = await send('POST', '/mcp?request=delayed');
    expect(res.statusCode).toBe(200);
    expect(activeCount).toBe(1);
    expect(activeCount === 0).toBe(false);
    const ended = consume(res);
    held.at(-1)!.end('done');
    await ended;
    await waitFor(() => activeCount === 0);
    expect(countHistory).toEqual([1, 0]);
  });

  it('decrements an aborted POST once on close', async () => {
    const { req, res } = await send('POST', '/mcp');
    expect(activeCount).toBe(1);
    const closed = new Promise(resolve => res.once('close', resolve));
    req.destroy();
    await closed;
    await waitFor(() => activeCount === 0);
    expect(countHistory).toEqual([1, 0]);
  });

  it('does not count unauthenticated, unrelated, or transition-rejected requests', async () => {
    const unauthorized = await send('POST', '/mcp', '');
    expect(unauthorized.res.statusCode).toBe(401);
    await consume(unauthorized.res);
    const unrelated = await send('POST', '/other');
    expect(unrelated.res.statusCode).toBe(404);
    await consume(unrelated.res);
    transitionsReserved = true;
    const rejected = await send('POST', '/mcp');
    expect(rejected.res.statusCode).toBe(503);
    await consume(rejected.res);
    expect(activeCount).toBe(0);
  });
});
