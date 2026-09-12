import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { type Bindings } from './contact-sheets'

export function createMcpServer(bindings: Bindings) {
  const server = new McpServer({
    name: 'sight-cache',
    version: '0.0.1',
  })

  server.registerTool(
    'hello',
    {
      description: 'Return a greeting',
      inputSchema: { name: z.string().optional() },
    },
    async ({ name }) => ({
      content: [{ type: 'text', text: `Hello, ${name ?? 'World'}!` }],
    }),
  )

  return server
}
