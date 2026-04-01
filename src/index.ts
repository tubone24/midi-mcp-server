#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, getPreviewPageHtml, getLatestPreviewData } from './server.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
  const baseUrl = `http://localhost:${port}`;

  const httpServer = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, mcp-session-id, mcp-protocol-version'
    );
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', name: 'midi-mcp-server', version: '0.2.0' }));
      return;
    }

    // --- Preview UI (browser) ---
    if (req.method === 'GET' && req.url === '/preview') {
      const html = getPreviewPageHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // --- API: get latest composition data ---
    if (req.method === 'GET' && req.url === '/api/composition') {
      const data = getLatestPreviewData();
      if (data.composition) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No composition available yet' }));
      }
      return;
    }

    // --- API: download latest MIDI ---
    if (req.method === 'GET' && req.url === '/api/midi') {
      const data = getLatestPreviewData();
      if (data.midi) {
        const buffer = Buffer.from(data.midi, 'base64');
        const filename = (data.title || 'composition').replace(/[^a-zA-Z0-9_-]/g, '_') + '.mid';
        res.writeHead(200, {
          'Content-Type': 'audio/midi',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buffer.length),
        });
        res.end(buffer);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No MIDI available yet' }));
      }
      return;
    }

    // MCP endpoint
    if (req.url === '/mcp' || req.url === '/') {
      const server = createServer(baseUrl);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
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
    console.error(`  MCP endpoint: ${baseUrl}/mcp`);
    console.error(`  Preview UI:   ${baseUrl}/preview`);
    console.error(`  Health check: ${baseUrl}/health`);
  });
}

// --- File-saving utility for local CLI usage ---
export async function saveMidiToFile(midiBase64: string, outputPath: string): Promise<string> {
  let outputFilePath: string;
  if (path.isAbsolute(outputPath)) {
    outputFilePath = outputPath;
  } else {
    const safeBaseDir = process.env.HOME || process.env.USERPROFILE || os.tmpdir();
    const midiDir = path.join(safeBaseDir, 'midi-files');
    if (!fs.existsSync(midiDir)) {
      fs.mkdirSync(midiDir, { recursive: true });
    }
    outputFilePath = path.join(midiDir, path.basename(outputPath));
  }

  fs.writeFileSync(outputFilePath, Buffer.from(midiBase64, 'base64'), 'binary');
  return outputFilePath;
}

// Main entry point
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
