import { Hono } from 'hono'
import { createMcpHandler } from 'agents/mcp/server'
import { createMcpServer } from './mcp-server'
import { requireCloudflareAccess } from './mcp-access'
import {
  consumeContactSheetJobs,
  enqueuePreviousHourContactSheets,
  type Bindings,
  type ContactSheetBuildJob,
} from './contact-sheets'
import { HomePage } from './home-page'

type AppEnv = { Bindings: Bindings }

const app = new Hono<AppEnv>()

const getMcpAllowedOriginHostnames = (env: Bindings) => {
  const hostnames = new Set([
    '127.0.0.1',
    'chat.openai.com',
    'chatgpt.com',
    'localhost',
  ])

  for (const hostname of env.MCP_ALLOWED_ORIGIN_HOSTNAMES?.split(',') ?? []) {
    const normalized = hostname.trim().toLowerCase()

    if (normalized) hostnames.add(normalized)
  }

  return [...hostnames]
}

app.get('/', (c) => {
  c.header('Cache-Control', 'no-store')
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self'; style-src 'unsafe-inline'",
  )
  c.header('Cross-Origin-Resource-Policy', 'same-origin')
  c.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=()')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('X-Robots-Tag', 'noindex, nofollow')

  return c.html(HomePage())
})

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname

    if (pathname === '/mcp') {
      const handler = createMcpHandler(() => createMcpServer(env), {
        allowedHostnames: [new URL(request.url).hostname],
        allowedOriginHostnames: getMcpAllowedOriginHostnames(env),
      })

      if (request.method === 'OPTIONS') {
        return handler(request, env, ctx)
      }

      const accessError = await requireCloudflareAccess(request, env)

      if (accessError) return accessError

      return handler(request, env, ctx)
    }

    return app.fetch(request, env, ctx)
  },
  scheduled: enqueuePreviousHourContactSheets,
  queue: consumeContactSheetJobs,
} satisfies ExportedHandler<Bindings, ContactSheetBuildJob>
