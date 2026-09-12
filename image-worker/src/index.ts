import { Hono } from 'hono'
import { createMcpHandler } from 'agents/mcp/server'
import { createMcpServer } from './mcp-server'
import {
  consumeContactSheetJobs,
  enqueuePreviousHourContactSheets,
  type Bindings,
  type ContactSheetBuildJob,
} from './contact-sheets'
import {
  buildImagePrefix,
  deviceIdPattern,
  isSamplingUnit,
  listFrames,
  sampleFrames,
  samplingLayouts,
} from './frame-sampling'
import { HomePage } from './home-page'

type AppEnv = { Bindings: Bindings }

const app = new Hono<AppEnv>()

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

app.get('/:deviceId', async (c) => {
  const deviceId = c.req.param('deviceId')
  const unit = c.req.query('unit')
  const beginAtValue = c.req.query('beginAt')

  if (!deviceIdPattern.test(deviceId)) {
    return c.json(
      {
        error: {
          code: 'device_id_invalid',
          message: 'deviceId must be a UUID.',
        },
      },
      400,
    )
  }

  if (!isSamplingUnit(unit)) {
    return c.json(
      {
        error: {
          code: 'unit_invalid',
          message: 'unit must be minute or hour.',
        },
      },
      400,
    )
  }

  const beginAtMs = beginAtValue ? Date.parse(beginAtValue) : Number.NaN

  if (!Number.isFinite(beginAtMs)) {
    return c.json(
      {
        error: {
          code: 'begin_at_invalid',
          message: 'beginAt must be a valid ISO 8601 timestamp.',
        },
      },
      400,
    )
  }

  const beginAt = new Date(beginAtMs)
  const isAligned =
    beginAt.getUTCMilliseconds() === 0 &&
    beginAt.getUTCSeconds() === 0 &&
    (unit === 'minute' || beginAt.getUTCMinutes() === 0)

  if (!isAligned) {
    return c.json(
      {
        error: {
          code: 'begin_at_unaligned',
          message:
            unit === 'hour'
              ? 'beginAt must be aligned to the start of an hour.'
              : 'beginAt must be aligned to the start of a minute.',
        },
      },
      400,
    )
  }

  const layout = samplingLayouts[unit]
  const endAt = new Date(beginAtMs + layout.durationMs)
  const prefix = buildImagePrefix(deviceId, beginAt, unit)
  const frames = await listFrames(c.env.BUCKET, prefix)
  const samples = sampleFrames(frames, {
    beginAt,
    endAt,
    rows: layout.rows,
    columns: layout.columns,
    toleranceMs: layout.toleranceMs,
  })

  return c.json({
    deviceId,
    unit,
    beginAt: beginAt.toISOString(),
    endAt: endAt.toISOString(),
    rows: layout.rows,
    columns: layout.columns,
    candidateCount: frames.length,
    selectedCount: samples.filter((sample) => sample.frame !== null).length,
    samples,
  })
})

export { sampleFrames }

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/mcp') {
      return createMcpHandler(
        () => createMcpServer(env),
      )(request, env, ctx)
    }

    return app.fetch(request, env, ctx)
  },
  scheduled: enqueuePreviousHourContactSheets,
  queue: consumeContactSheetJobs,
} satisfies ExportedHandler<Bindings, ContactSheetBuildJob>
