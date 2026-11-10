import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpBridge, waitForMcpStartup } from './mcp-stdio-bridge.mjs';

function fakeClient(callTool, tools = [{ name: 'guided_workflow_get' }]) {
  return { callTool, listTools: async () => ({ tools }), close: async () => {} };
}

test('startup waits for token and listener, then exposes and calls catalog once', async () => {
  let attempts = 0, now = 0, calls = 0;
  const bridge = createMcpBridge({
    readToken: async () => { if (++attempts === 1) throw Object.assign(new Error('not ready'), { code: 'MCP_TOKEN_NOT_READY' }); return 'scoped-token'; },
    connect: async () => { if (attempts === 2) throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }); return { tools: [{ name: 'asset_job_catalog_submit' }], client: fakeClient(async () => { calls++; return { content: [{ text: 'pending' }] }; }, [{ name: 'asset_job_catalog_submit' }]) }; },
  });
  assert.deepEqual(await waitForMcpStartup(bridge, { timeoutMs: 1000, intervalMs: 100, now: () => now, sleep: async ms => { now += ms; } }), [{ name: 'asset_job_catalog_submit' }]);
  assert.equal((await bridge.callTool('asset_job_catalog_submit', {})).content[0].text, 'pending');
  assert.equal(calls, 1); assert.equal(attempts, 3); await bridge.close();
});

test('startup is bounded, fails authentication immediately, and can be cancelled', async () => {
  let now = 0, attempts = 0;
  const missing = createMcpBridge({ readToken: async () => { attempts++; throw Object.assign(new Error('not ready'), { code: 'MCP_TOKEN_NOT_READY' }); }, connect: async () => { throw new Error('unexpected'); } });
  await assert.rejects(waitForMcpStartup(missing, { timeoutMs: 250, intervalMs: 100, now: () => now, sleep: async ms => { now += ms; } }), /not ready/);
  assert.equal(now, 250); assert.equal(attempts, 4);
  let authAttempts = 0;
  const denied = createMcpBridge({ readToken: async () => 'token', connect: async () => { authAttempts++; throw Object.assign(new Error('denied'), { status: 401 }); } });
  await assert.rejects(waitForMcpStartup(denied), /denied/); assert.equal(authAttempts, 1);
  const controller = new AbortController();
  const waiting = waitForMcpStartup(missing, { signal: controller.signal }); controller.abort(new Error('cancelled'));
  await assert.rejects(waiting, /cancelled/);
});

test('refreshes the scoped token after a stale-auth rejection and retries once', async () => {
  const tokens = ['old-token', 'current-token'];
  let connects = 0, calls = 0;
  const bridge = createMcpBridge({
    readToken: async () => tokens.shift(),
    connect: async token => {
      connects++;
      assert.equal(token, connects === 1 ? 'old-token' : 'current-token');
      return { client: fakeClient(async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('Unauthorized'), { status: 401 });
        return { content: [{ text: 'fresh' }] };
      }, [{ name: 'guided_workflow_get', version: connects }]), tools: [{ name: 'guided_workflow_get', version: connects }] };
    },
  });
  assert.equal((await bridge.callTool('guided_workflow_get', { id: 'x' })).content[0].text, 'fresh');
  assert.equal(connects, 2);
  assert.equal(calls, 2);
  assert.equal((await bridge.listTools())[0].version, 2);
  await bridge.close();
});

test('retries a lost read response but never replays an uncertain mutation', async () => {
  let connects = 0, readCalls = 0, mutationCalls = 0;
  const bridge = createMcpBridge({
    readToken: async () => `token-${connects + 1}`,
    connect: async () => {
      connects++;
      return { client: fakeClient(async ({ name }) => {
        if (name === 'guided_workflow_get') {
          if (++readCalls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
          return { content: [{ text: 'ok' }] };
        }
        mutationCalls++;
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      }) , tools: [] };
    },
  });
  assert.equal((await bridge.callTool('guided_workflow_get', {})).content[0].text, 'ok');
  assert.equal(readCalls, 2);
  await assert.rejects(bridge.callTool('guided_source_add', {}), /socket hang up/);
  assert.equal(mutationCalls, 1);
  await bridge.close();
});

test('refreshes tool discovery after an app restart rotates its MCP token', async () => {
  const tokens = ['token-before-restart', 'token-after-restart'];
  let connects = 0, listCalls = 0;
  const bridge = createMcpBridge({
    readToken: async () => tokens.shift(),
    connect: async token => {
      connects++;
      return { client: { ...fakeClient(async () => ({ content: [] })), listTools: async () => {
        listCalls++;
        if (listCalls === 1) throw Object.assign(new Error('Unauthorized'), { status: 401 });
        return { tools: [{ name: `token-${token}` }] };
      } }, tools: [{ name: `token-${token}` }] };
    },
  });
  assert.equal((await bridge.listTools())[0].name, 'token-token-before-restart');
  assert.equal((await bridge.listTools())[0].name, 'token-token-after-restart');
  assert.equal(connects, 2);
  await bridge.close();
});

test('stdio ListTools requests expose newly registered manual batch tools from the live app catalog', async () => {
  let published = [{ name: 'guided_workflow_get' }];
  const bridge = createMcpBridge({
    readToken: async () => 'token',
    connect: async () => ({ client: { ...fakeClient(async () => ({ content: [] })), listTools: async () => ({ tools: published }) }, tools: published }),
  });
  expectNames(await bridge.listTools(), ['guided_workflow_get']);
  published = [{ name: 'guided_workflow_get' }, { name: 'guided_manual_image_prompts_save' }, { name: 'asset_job_manual_image_prompts_save' }];
  expectNames(await bridge.listTools(), ['guided_workflow_get', 'guided_manual_image_prompts_save', 'asset_job_manual_image_prompts_save']);
  await bridge.close();
});

function expectNames(tools, names) {
  assert.deepEqual(tools.map(tool => tool.name), names);
}

test('serializes concurrent calls through one MCP client', async () => {
  let active = 0, peak = 0;
  const bridge = createMcpBridge({
    readToken: async () => 'token',
    connect: async () => ({ client: fakeClient(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return { content: [] };
    }), tools: [] }),
  });
  await Promise.all([bridge.callTool('guided_workflow_get', {}), bridge.callTool('guided_workflow_get', {})]);
  assert.equal(peak, 1);
  await bridge.close();
});
