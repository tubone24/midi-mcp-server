#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import * as http from 'http';

const args = process.argv.slice(2);
const isHttp = args.includes('--http');
const portArg = args.find((a) => a.startsWith('--port='));
const port = portArg ? parseInt(portArg.split('=')[1], 10) : 3001;

async function runStdio() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MIDI MCP server running on stdio');
}

async function runHttp() {
  const httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept, mcp-session-id, mcp-protocol-version'
    );
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', name: 'midi-mcp-server', version: '0.2.0' }));
      return;
    }

    // MCP endpoint - stateless (new server per request)
    if (req.url === '/mcp' || req.url === '/') {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on('close', () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(port, () => {
    console.error(`MIDI MCP server running on HTTP port ${port}`);
    console.error(`  MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`  Health check: http://localhost:${port}/health`);
  });
}

async function main() {
  if (isHttp) {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
