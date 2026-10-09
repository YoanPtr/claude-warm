#!/usr/bin/env node
// Smallest MCP server over stdio (newline-delimited JSON-RPC), no dependencies.
// One tool, `vault_word`, returns the word given in BENCH_MCP_WORD so a test can prove the tool was called.
import { createInterface } from 'node:readline';

const word = process.env.BENCH_MCP_WORD || 'unset';
const tool = { name: 'vault_word', description: 'Returns the project vault word.', inputSchema: { type: 'object', properties: {} } };
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') send(msg.id, { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'bench', version: '1.0.0' } });
  else if (msg.method === 'tools/list') send(msg.id, { tools: [tool] });
  else if (msg.method === 'tools/call') send(msg.id, { content: [{ type: 'text', text: `The vault word is ${word}.` }] });
  else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not found' } }) + '\n');
});
