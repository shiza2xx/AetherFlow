import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolveMcpTokenPath } from './mcp-stdio-profile.mjs';

const timeoutMs = 8000;
function parse(argv) {
  const command = argv.shift(); if (!['context', 'publish', 'replace'].includes(command)) throw new Error('Use context, publish, or replace --manifest <absolute JSON>.');
  const options = {};
  while (argv.length) { const key = argv.shift(); if (!key.startsWith('--') || argv.length === 0) throw new Error(`Missing value for ${key}.`); options[key.slice(2)] = argv.shift(); }
  return { command, options };
}
function tokenPath() { return resolveMcpTokenPath(); }
async function withTimeout(promise, label) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
async function connect() {
  const file = tokenPath(); if (!fs.existsSync(file)) throw new Error('AetherFlow MCP token is unavailable. Open AetherFlow, then retry.');
  const token = fs.readFileSync(file, 'utf8').trim(); if (!token) throw new Error('AetherFlow MCP token is empty. Open AetherFlow, then retry.');
  const port = Number(process.env.AETHERFLOW_MCP_PORT || process.env.ATELIER_MCP_PORT || 42173); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('AETHERFLOW_MCP_PORT must be an integer from 1024 to 65535.');
  const client = new Client({ name: 'aetherflow-unity-report-cli', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) } });
  await withTimeout(client.connect(transport), 'AetherFlow MCP connection');
  return { client, transport };
}
function resultData(result) {
  if (result.isError) throw new Error(result.content?.map(item => item.text || '').join('\n') || 'AetherFlow MCP returned a publish error.');
  const text = result.content?.find(item => item.type === 'text')?.text; if (!text) throw new Error('AetherFlow MCP returned an empty result.');
  const value = JSON.parse(text); if (!value.ok) throw new Error(value.error?.message || 'AetherFlow MCP rejected the request.'); return value.data;
}
async function main(argv) {
  const { command, options } = parse(argv), { client, transport } = await connect();
  try {
    const tools = (await withTimeout(client.listTools(), 'AetherFlow MCP tool discovery')).tools.map(item => item.name);
    if (command === 'context') {
      const data = resultData(await withTimeout(client.callTool({ name: 'project_get_context', arguments: {} }), 'AetherFlow context request'));
      console.log(JSON.stringify({ locale: data.settings?.locale || 'en', workspace: data.workspace, project: data.project ? { id: data.project.id, name: data.project.name, path: data.project.data?.unityPath || data.settings?.unityPath || null } : null, tools: { unity_report_publish: tools.includes('unity_report_publish'), unity_report_replace_evidence: tools.includes('unity_report_replace_evidence'), project_get_context: tools.includes('project_get_context') }, ...(tools.includes('unity_report_publish') && tools.includes('unity_report_replace_evidence') ? {} : { notice: 'The running AetherFlow app does not expose the current Unity report tools; restart the app to load the updated tools.' }) }, null, 2)); return;
    }
    if (!options.manifest || !path.isAbsolute(options.manifest)) throw new Error('publish requires --manifest with an absolute JSON path.');
    const tool = command === 'replace' ? 'unity_report_replace_evidence' : 'unity_report_publish';
    if (!tools.includes(tool)) throw new Error(`The running AetherFlow app does not expose ${tool}. Restart AetherFlow and retry; the manifest is retained.`);
    const manifestPath = fs.realpathSync.native(options.manifest); if (!fs.statSync(manifestPath).isFile()) throw new Error('Manifest must be a JSON file.');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Manifest JSON must contain an object.');
    const args = { ...manifest };
    if (typeof args.path === 'string' && !path.isAbsolute(args.path)) args.path = path.resolve(path.dirname(manifestPath), args.path);
    if (args.evidence && typeof args.evidence === 'object') for (const [role, value] of Object.entries(args.evidence)) if (typeof value === 'string' && !path.isAbsolute(value)) args.evidence[role] = path.resolve(path.dirname(manifestPath), value);
    if (Array.isArray(args.videoViews)) for (const view of args.videoViews) if (view?.evidence && typeof view.evidence === 'object') for (const [side, value] of Object.entries(view.evidence)) if (typeof value === 'string' && !path.isAbsolute(value)) view.evidence[side] = path.resolve(path.dirname(manifestPath), value);
    const data = resultData(await withTimeout(client.callTool({ name: tool, arguments: args }), `Unity report ${command}`));
    const output = command === 'replace'
      ? { reportId: data.report?.id, replayed: data.replayed === true, managedArtifact: { role: args.role, id: data.artifact?.id, hash: data.artifact?.data?.hash } }
      : { reportId: data.report?.id, replayed: data.replayed === true, managedArtifacts: (data.artifacts || []).map(item => ({ role: item.role, id: item.artifact?.id, hash: item.artifact?.data?.hash })) };
    console.log(JSON.stringify(output, null, 2));
  } finally { await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}
main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
