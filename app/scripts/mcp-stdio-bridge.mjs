const SAFE_READ_TOOLS = new Set([
  'project_get_context','project_get_status','asset_list','asset_get','reference_list','plan_list','task_list',
  'workflow_get_status','guided_workflow_get','slot_list','artifact_list_versions','artifact_get_manifest',
  'checkpoint_list','blender_job_list','blender_job_events','viewer_inspect','unity_report_list',
]);

function httpStatus(error) {
  for (let current = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
    const value = Number(current.status ?? current.statusCode ?? current.httpStatus);
    if (Number.isInteger(value)) return value;
  }
  return undefined;
}

function startupTransient(error) {
  if (httpStatus(error) !== undefined) return false;
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth++) {
    if (['MCP_TOKEN_NOT_READY', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(String(current.code || ''))) return true;
  }
  return false;
}

// Startup may race token publication or the loopback listener. Never retry auth,
// configuration or protocol errors, and do not replay mutations here.
export async function waitForMcpStartup(bridge, { timeoutMs = 5000, intervalMs = 250, now = () => Date.now(), signal, sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || new Error('MCP startup cancelled.'));
  const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
  const cancel = () => { clearTimeout(timer); reject(signal.reason || new Error('MCP startup cancelled.')); };
  signal?.addEventListener('abort', cancel, { once: true });
}) } = {}) {
  const deadline = now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw signal.reason || new Error('MCP startup cancelled.');
    try { return await bridge.listTools(); }
    catch (error) {
      const remaining = deadline - now();
      if (!startupTransient(error) || remaining <= 0) throw error;
      await sleep(Math.min(intervalMs, remaining), signal);
    }
  }
}

function canSafelyRetry(error, toolName, safeReads) {
  if (httpStatus(error) === 401) return true;
  if (!safeReads.has(toolName)) return false;
  const code = String(error?.code || error?.cause?.code || '');
  return ['ECONNRESET','ECONNREFUSED','EPIPE','UND_ERR_SOCKET'].includes(code)
    || /connection (?:closed|terminated)|fetch failed|socket hang up/i.test(String(error?.message || ''));
}

/** Serializes bridge calls and refreshes credentials only after a failed request. */
export function createMcpBridge({ readToken, connect, safeReads = SAFE_READ_TOOLS }) {
  let client;
  let tools = [];
  let queue = Promise.resolve();
  const enqueue = operation => {
    const current = queue.then(operation);
    queue = current.catch(() => {});
    return current;
  };
  const disconnect = async () => {
    const old = client;
    client = undefined;
    tools = [];
    try { await old?.close(); } catch {}
  };
  const connectFresh = async () => {
    await disconnect();
    const token = await readToken();
    const connected = await connect(token);
    client = connected.client;
    tools = connected.tools;
    return connected;
  };
  const ready = async () => client || (await connectFresh()).client;
  const retry = async (error, toolName, invoke) => {
    if (!canSafelyRetry(error, toolName, safeReads)) throw error;
    const { client: fresh } = await connectFresh();
    try { return await invoke(fresh); }
    catch (retryError) { await disconnect(); throw retryError; }
  };
  return {
    listTools: () => enqueue(async () => {
      if (!client) await connectFresh();
      else {
        try { tools = (await client.listTools()).tools; }
        catch { const { tools: freshTools } = await connectFresh(); tools = freshTools; }
      }
      return tools;
    }),
    callTool: (name, args) => enqueue(async () => {
      const current = await ready();
      try { return await current.callTool({ name, arguments: args || {} }); }
      catch (error) { return retry(error, name, fresh => fresh.callTool({ name, arguments: args || {} })); }
    }),
    close: () => enqueue(disconnect),
  };
}
