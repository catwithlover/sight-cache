import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { bodyLimit } from 'hono/body-limit'
import { validator } from 'hono/validator'
import {
  authenticateDeviceToken,
  updateDeviceFrameState,
  type AuthenticatedDevice,
} from '@sight-cache/db/ingest'
import { HomePage } from './home-page'

type AppEnv = {
  Bindings: {
    BUCKET: R2Bucket,
    DB: D1Database
  }
  Variables: {
    accessDevice: AuthenticatedDevice
  }
}

const imageFilenamePattern =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)([+-])(\d{2})(\d{2})\.jpg$/u
const timezonePattern =
  /^(?:UTC|[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+)$/u
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_CAPTURE_CLOCK_SKEW_MS = 5 * 60 * 1000

const parseImageFilename = (filename: string) => {
  const match = imageFilenamePattern.exec(filename)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const offsetHours = Number(match[8])
  const offsetMinutes = Number(match[9])
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`)

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    offsetHours > 14 ||
    offsetMinutes > 59 ||
    (offsetHours === 14 && offsetMinutes !== 0)
  ) {
    return null
  }

  const capturedAt = new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7]}${match[8]}:${match[9]}`,
  )

  return Number.isNaN(capturedAt.getTime()) ? null : capturedAt
}

const normalizeTimezone = (value: string) => {
  if (value.length > 64 || !timezonePattern.test(value)) return null

  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions()
      .timeZone
  } catch {
    return null
  }
}

const formatCapturedAtLocal = (capturedAt: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(capturedAt)
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const zoneName = values.timeZoneName
  const offset =
    zoneName === 'GMT' || zoneName === 'UTC'
      ? '+00:00'
      : zoneName?.replace(/^GMT/u, '')

  if (!offset || !/^[+-]\d{2}:\d{2}$/u.test(offset)) {
    throw new Error(`Could not resolve the UTC offset for ${timezone}`)
  }

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}${offset}`
}

const buildImagePath = (deviceId: string, capturedAt: Date) => {
  const dateTime = capturedAt.toISOString()
  const pathTimestamp = dateTime
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.000', '')

  return [
    'frames',
    deviceId,
    dateTime.slice(0, 4),
    dateTime.slice(5, 7),
    dateTime.slice(8, 10),
    dateTime.slice(11, 13),
    dateTime.slice(14, 16),
    `${pathTimestamp}.jpg`,
  ].join('/')
}

const validateIngestHeaders = validator('header', (headers, c) => {
  const originalFilename = headers['x-filename']
  const capturedAt = originalFilename
    ? parseImageFilename(originalFilename)
    : null

  if (!capturedAt) {
    return c.json(
      {
        error: {
          code: 'filename_invalid',
          message:
            'x-filename must be a valid ISO 8601 JPEG filename, such as 2026-09-12T03:42:47+0800.jpg.',
        },
      },
      400,
    )
  }

  if (capturedAt.getTime() > Date.now() + MAX_CAPTURE_CLOCK_SKEW_MS) {
    return c.json(
      {
        error: {
          code: 'captured_at_future',
          message:
            'x-filename capture time must not be more than 5 minutes in the future.',
        },
      },
      400,
    )
  }

  const timezoneHeader = headers['x-timezone']?.trim()
  if (!timezoneHeader) {
    return c.json(
      {
        error: {
          code: 'timezone_required',
          message: 'X-Timezone is required.',
        },
      },
      400,
    )
  }

  const timezone = normalizeTimezone(timezoneHeader)
  if (!timezone) {
    return c.json(
      {
        error: {
          code: 'timezone_invalid',
          message:
            'X-Timezone must be an IANA time zone, such as Asia/Taipei.',
        },
      },
      400,
    )
  }

  const contentType = headers['content-type']
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()

  if (contentType !== 'image/jpeg') {
    return c.json(
      {
        error: {
          code: 'content_type_invalid',
          message: 'Content-Type must be image/jpeg.',
        },
      },
      415,
    )
  }

  const contentLengthHeader = headers['content-length']
  if (!contentLengthHeader) {
    return c.json(
      {
        error: {
          code: 'content_length_required',
          message: 'Content-Length is required.',
        },
      },
      411,
    )
  }

  const contentLength = Number(contentLengthHeader)
  if (
    !/^\d+$/u.test(contentLengthHeader) ||
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0
  ) {
    return c.json(
      {
        error: {
          code: 'content_length_invalid',
          message: 'Content-Length must be a positive integer.',
        },
      },
      400,
    )
  }

  return { capturedAt, contentLength, timezone }
})

const limitImageBody = bodyLimit({
  maxSize: MAX_IMAGE_SIZE_BYTES,
  onError: (c) =>
    c.json(
      {
        error: {
          code: 'image_too_large',
          message: 'Image size must not exceed 10 MiB.',
        },
      },
      413,
    ),
})

const app = new Hono<AppEnv>()

app.use(
  '/api/*',
  bearerAuth<AppEnv>({
    verifyToken: async (token, c) => {
      const device = await authenticateDeviceToken(c.env.DB, token)

      if (!device) {
        return false
      }

      c.set('accessDevice', device)

      return true
    },
  }),
)

app.post(
  '/api/ingest',
  validateIngestHeaders,
  limitImageBody,
  async (c) => {
    const accessDevice = c.get('accessDevice')
    const { capturedAt, timezone } = c.req.valid('header')
    const body = c.req.raw.body

    if (!body) {
      return c.json(
        {
          error: {
            code: 'body_missing',
            message: 'Image body is required.',
          },
        },
        400,
      )
    }

    const dateTime = capturedAt.toISOString()
    const path = buildImagePath(accessDevice.id, capturedAt)
    const storedFrame = await c.env.BUCKET.put(path, body, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: 'no-store',
      },
      customMetadata: {
        capturedAt: dateTime,
        capturedAtLocal: formatCapturedAtLocal(capturedAt, timezone),
        timezone,
      },
    })

    if (!storedFrame) {
      return c.json(
        {
          error: {
            code: 'frame_already_exists',
            message:
              'A frame already exists for this device and capture time.',
          },
        },
        409,
      )
    }

    c.executionCtx.waitUntil(
      updateDeviceFrameState(
        c.env.DB,
        accessDevice,
        storedFrame.uploaded,
        timezone,
      ).catch((error) => {
        console.error('Failed to update device frame state', error)
      }),
    )

    return c.json({
      status: 200,
      message: 'process successfully',
    })
  },
)

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

export default app
