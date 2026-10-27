import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMcpBridge } from './mcp-stdio-bridge.mjs';
import { resolveMcpTokenPath } from './mcp-stdio-profile.mjs';

const tokenPath=resolveMcpTokenPath();
function currentMcpPort(){const port=Number(process.env.AETHERFLOW_MCP_PORT||process.env.ATELIER_MCP_PORT||42173);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid AetherFlow MCP port.');return port;}
const server=new Server({name:'aetherflow-stdio-bridge',version:'1.0.0'},{capabilities:{tools:{}}});
const bridge=createMcpBridge({
  readToken:async()=>{if(!fs.existsSync(tokenPath))throw new Error('AetherFlow is closed. Open the application and retry.');const token=fs.readFileSync(tokenPath,'utf8').trim();if(!token)throw new Error('AetherFlow is closed. Open the application and retry.');return token;},
  connect:async token=>{const client=new Client({name:'aetherflow-stdio-bridge',version:'1.0.0'},{capabilities:{}});const port=currentMcpPort();const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});await client.connect(transport);const tools=(await client.listTools()).tools;return {client,tools};},
});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:await bridge.listTools()}));
server.setRequestHandler(CallToolRequestSchema,async request=>bridge.callTool(request.params.name,request.params.arguments||{}));
try { await bridge.listTools(); }
catch(error) {
  process.stderr.write('AetherFlow is closed or unreachable. Open the application and retry.\n');
  process.exitCode=1;
}
if(!process.exitCode){const stdio=new StdioServerTransport();await server.connect(stdio);}
