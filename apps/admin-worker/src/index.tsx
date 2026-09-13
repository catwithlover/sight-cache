import { Hono } from 'hono'
import { requireAccess, type AppEnv } from './access'
import { AdminPage } from './admin-page'
import { HomePage } from './home-page'
import {
  createDevice,
  createDeviceInputSchema,
  deviceIdSchema,
  disableDevice,
  listDevices,
  rotateDeviceToken,
} from './devices'

const app = new Hono<AppEnv>()

app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  )
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
  c.header('Cross-Origin-Resource-Policy', 'same-origin')
  c.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=()')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('X-Robots-Tag', 'noindex, nofollow')
  await next()
})

app.get('/', (c) => {
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self'; style-src 'unsafe-inline'",
  )

  return c.html(<HomePage />)
})

app.use('*', requireAccess)

app.use('/api/*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const requestOrigin = new URL(c.req.url).origin
    const origin = c.req.header('origin')

    if (origin !== requestOrigin) {
      return c.json(
        {
          error: {
            code: 'origin_invalid',
            message: '請求來源無效。',
          },
        },
        403,
      )
    }
  }

  await next()
})

app.get('/admin', async (c) => {
  const devices = await listDevices(c.env.DB)
  return c.html(<AdminPage devices={devices} user={c.get('accessUser')} />)
})

app.get('/api/devices', async (c) => {
  const devices = await listDevices(c.env.DB)
  return c.json({ data: { devices } })
})

app.post('/api/devices', async (c) => {
  const contentType = c.req.header('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    return c.json(
      {
        error: {
          code: 'content_type_invalid',
          message: '請使用 application/json 傳送資料。',
        },
      },
      415,
    )
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      {
        error: {
          code: 'json_invalid',
          message: 'JSON 格式無效。',
        },
      },
      400,
    )
  }

  const input = createDeviceInputSchema.safeParse(body)
  if (!input.success) {
    return c.json(
      {
        error: {
          code: 'device_invalid',
          message: input.error.issues[0]?.message ?? '設備資料無效。',
          issues: input.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      400,
    )
  }

  const result = await createDevice(c.env.DB, input.data.name)
  return c.json({ data: result }, 201)
})

app.post('/api/devices/:id/token', async (c) => {
  const deviceId = deviceIdSchema.safeParse(c.req.param('id'))
  if (!deviceId.success) {
    return c.json(
      {
        error: {
          code: 'device_id_invalid',
          message: '設備 ID 格式無效。',
        },
      },
      400,
    )
  }

  const result = await rotateDeviceToken(c.env.DB, deviceId.data)
  if (result.kind === 'not_found') {
    return c.json(
      {
        error: {
          code: 'device_not_found',
          message: '找不到指定設備。',
        },
      },
      404,
    )
  }

  if (result.kind === 'disabled') {
    return c.json(
      {
        error: {
          code: 'device_disabled',
          message: '已停用的設備無法產生 Token。',
        },
      },
      409,
    )
  }

  return c.json({
    data: {
      token: result.token,
      tokenHint: result.tokenHint,
    },
  })
})

app.delete('/api/devices/:id', async (c) => {
  const deviceId = deviceIdSchema.safeParse(c.req.param('id'))
  if (!deviceId.success) {
    return c.json(
      {
        error: {
          code: 'device_id_invalid',
          message: '設備 ID 格式無效。',
        },
      },
      400,
    )
  }

  const result = await disableDevice(c.env.DB, deviceId.data)
  if (result === 'not_found') {
    return c.json(
      {
        error: {
          code: 'device_not_found',
          message: '找不到指定設備。',
        },
      },
      404,
    )
  }

  return c.json({
    data: {
      status: result,
    },
  })
})

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json(
      {
        error: {
          code: 'not_found',
          message: '找不到指定 API。',
        },
      },
      404,
    )
  }

  return c.text('Not found', 404)
})

app.onError((error, c) => {
  console.error('Admin request failed', error)

  if (c.req.path.startsWith('/api/')) {
    return c.json(
      {
        error: {
          code: 'internal_error',
          message: '管理服務暫時無法完成操作。',
        },
      },
      500,
    )
  }

  return c.text('Admin service is temporarily unavailable.', 500)
})

export default app
