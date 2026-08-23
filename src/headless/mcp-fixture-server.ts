import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Fixture for the MCP adapter integration test. It intentionally makes no
// game decision; the boundary test covers SDK handshake, schema, and parsing.
const server = new McpServer({ name: 'open-empires-fixture', version: '1.0.0' });
server.registerTool('decide', {
  description: 'Return commands for one filtered observation',
  inputSchema: {
    type: z.literal('observation'),
    observation: z.unknown(),
    text: z.string(),
    rejected: z.array(z.unknown()),
  },
}, async () => ({
  content: [{
    type: 'text',
    text: JSON.stringify({ type: 'commands', time: 0, commands: [] }),
  }],
}));
await server.connect(new StdioServerTransport());
