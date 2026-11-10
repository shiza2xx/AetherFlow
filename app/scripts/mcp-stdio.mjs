import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpBridge, waitForMcpStartup } from './mcp-stdio-bridge.mjs';
import { resolveMcpTokenPath } from './mcp-stdio-profile.mjs';

const tokenPath=resolveMcpTokenPath();
function currentMcpPort(){const port=Number(process.env.AETHERFLOW_MCP_PORT||process.env.ATELIER_MCP_PORT||42173);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid AetherFlow MCP port.');return port;}
const server=new Server({name:'aetherflow-stdio-bridge',version:'1.0.0'},{capabilities:{tools:{}}});
const bridge=createMcpBridge({
  readToken:async()=>{let token;try{token=fs.readFileSync(tokenPath,'utf8').trim();}catch(error){if(error.code==='ENOENT')throw Object.assign(new Error('MCP token is not ready.'),{code:'MCP_TOKEN_NOT_READY'});throw error;}if(!token)throw Object.assign(new Error('MCP token is not ready.'),{code:'MCP_TOKEN_NOT_READY'});return token;},
  connect:async token=>{const client=new Client({name:'aetherflow-stdio-bridge',version:'1.0.0'},{capabilities:{}});const port=currentMcpPort();const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});try{await client.connect(transport,{timeout:1000});const tools=(await client.listTools({}, {timeout:1000})).tools;return {client,tools};}catch(error){await client.close().catch(()=>{});throw error;}},
});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:await bridge.listTools()}));
server.setRequestHandler(CallToolRequestSchema,async request=>bridge.callTool(request.params.name,request.params.arguments||{}));
try { await waitForMcpStartup(bridge); }
catch(error) {
  process.stderr.write('AetherFlow MCP could not start or authenticate. Check that the application is running and its MCP service is ready, then restart the Codex session.\n');
  process.exitCode=1;
}
if(!process.exitCode){const stdio=new StdioServerTransport();await server.connect(stdio);}
