import {
  activeDeviceExists,
  listActiveDeviceIds,
} from '@sight-cache/db/read'
import {
  buildImagePrefix,
  deviceIdPattern,
  listFrames,
  sampleFrames,
  samplingLayouts,
  type FrameSample,
  type SamplingUnit,
} from './frame-sampling'
import { contactSheetLayouts } from './contact-sheet-layout'
import { z } from 'zod'

export type ContactSheetBuildJob = {
  version: 1
  type: 'build-hourly-contact-sheets'
  deviceId: string
  beginAt: string
}

export type Bindings = Omit<
  CloudflareBindings,
  'CONTACT_SHEET_BUILDER_QUEUE'
> & {
  CONTACT_SHEET_BUILDER_QUEUE: Queue<ContactSheetBuildJob>
  ACCESS_AUD?: string
  ACCESS_TEAM_DOMAIN?: string
  LOCAL_MCP_BYPASS?: string
  LOCAL_MCP_EMAIL?: string
  MCP_ALLOWED_ORIGIN_HOSTNAMES?: string
  MCP_ENABLE_FRAME_DOWNLOAD_URLS?: string
  MCP_MAX_LOOKBACK_DAYS?: string
  R2_ACCESS_KEY_ID?: string
  R2_ACCOUNT_ID?: string
  R2_BUCKET_NAME?: string
  R2_SECRET_ACCESS_KEY?: string
}

export const TILE_WIDTH = 640
export const TILE_HEIGHT = 360
export const CONTACT_SHEET_COLUMNS = contactSheetLayouts.hour.columns
const CONTACT_SHEET_ROWS = {
  minute: contactSheetLayouts.minute.rows,
  hour: contactSheetLayouts.hour.rows,
} satisfies Record<SamplingUnit, number>
const CONTACT_SHEET_WIDTH = CONTACT_SHEET_COLUMNS * TILE_WIDTH
const CONTACT_SHEET_BASE_URL = 'https://assets.local/blank.png'
const MAX_CONTACT_SHEET_TILES_PER_PASS = 5
const CONTACT_SHEET_SCHEMA_VERSION = 1
const MAX_CONTACT_SHEET_SOURCE_BYTES = 48 * 1024 * 1024
const QUEUE_SEND_BATCH_SIZE = 100

const contactSheetSlotSchema = z.strictObject({
  slot: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  targetAt: z.iso.datetime(),
  slotEndAt: z.iso.datetime(),
  capturedAt: z.iso.datetime().nullable(),
  capturedAtLocal: z.iso.datetime({ offset: true }).nullable(),
  deltaMs: z.number().nonnegative().nullable(),
  status: z.enum(['captured', 'missing']),
  timezone: z.string().min(1).max(64).nullable(),
})

const contactSheetSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  number: z.number().int().positive(),
  key: z.string().min(1),
  rows: z.number().int().positive(),
  columns: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  selectedCount: z.number().int().nonnegative(),
  slots: z.array(contactSheetSlotSchema),
})

export const contactSheetManifestSchema = z.strictObject({
  schemaVersion: z.literal(CONTACT_SHEET_SCHEMA_VERSION),
  type: z.enum(['minute-contact-sheets', 'hourly-contact-sheets']),
  deviceId: z.string().regex(deviceIdPattern),
  unit: z.enum(['minute', 'hour']),
  beginAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  generatedAt: z.iso.datetime(),
  candidateCount: z.number().int().nonnegative(),
  selectedCount: z.number().int().nonnegative(),
  sampling: z.strictObject({
    slotCount: z.number().int().positive(),
    toleranceMs: z.number().nonnegative(),
  }),
  layout: z.strictObject({
    order: z.literal('row-major'),
    origin: z.literal('top-left'),
    tileWidth: z.number().int().positive(),
    tileHeight: z.number().int().positive(),
    rows: z.number().int().positive(),
    columns: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sheetCount: z.number().int().positive(),
  }),
  sheets: z.array(contactSheetSchema),
})

export type ContactSheetManifest = z.infer<typeof contactSheetManifestSchema>

export const arrayBufferToStream = (buffer: ArrayBuffer) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer))
      controller.close()
    },
  })

const getPreviousHourBeginAt = (scheduledTime: number) => {
  const durationMs = samplingLayouts.hour.durationMs

  return new Date(
    Math.floor(scheduledTime / durationMs) * durationMs - durationMs,
  )
}

export const buildContactSheetPrefix = (
  deviceId: string,
  beginAt: Date,
  unit: SamplingUnit,
) => {
  const dateTime = beginAt.toISOString()
  const segments = [
    'contact-sheets',
    `v${CONTACT_SHEET_SCHEMA_VERSION}`,
    deviceId,
    dateTime.slice(0, 4),
    dateTime.slice(5, 7),
    dateTime.slice(8, 10),
    dateTime.slice(11, 13),
  ]

  if (unit === 'minute') segments.push(dateTime.slice(14, 16))

  return `${segments.join('/')}/`
}

const parseContactSheetBuildJob = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    throw new Error('Queue message body must be an object')
  }

  const job = value as Partial<ContactSheetBuildJob>

  if (
    job.version !== CONTACT_SHEET_SCHEMA_VERSION ||
    job.type !== 'build-hourly-contact-sheets' ||
    typeof job.deviceId !== 'string' ||
    !deviceIdPattern.test(job.deviceId) ||
    typeof job.beginAt !== 'string'
  ) {
    throw new Error('Queue message is not a valid contact sheet build job')
  }

  const beginAtMs = Date.parse(job.beginAt)
  const beginAt = new Date(beginAtMs)

  if (
    !Number.isFinite(beginAtMs) ||
    beginAt.getUTCMilliseconds() !== 0 ||
    beginAt.getUTCSeconds() !== 0 ||
    beginAt.getUTCMinutes() !== 0
  ) {
    throw new Error('Queue job beginAt must be aligned to a UTC hour')
  }

  return {
    deviceId: job.deviceId,
    beginAt,
  }
}

export const composeContactSheetImage = async (
  env: Pick<Bindings, 'ASSETS' | 'IMAGES'>,
  frameInputs: (ArrayBuffer | null)[],
  rows: number,
) => {
  if (
    rows < 1 ||
    rows > CONTACT_SHEET_ROWS.hour ||
    frameInputs.length < 1 ||
    frameInputs.length > rows * CONTACT_SHEET_COLUMNS
  ) {
    throw new Error('Contact sheet dimensions are invalid')
  }

  const baseImage = await env.ASSETS.fetch(CONTACT_SHEET_BASE_URL)

  if (!baseImage.ok || !baseImage.body) {
    throw new Error(
      `Contact sheet base image is unavailable (${baseImage.status})`,
    )
  }

  // The base is already output-sized, so each pass is reserved for tile work.
  let transformer = env.IMAGES.input(
    arrayBufferToStream(await baseImage.arrayBuffer()),
  )
  let tilesInPass = 0

  for (let index = 0; index < frameInputs.length; index += 1) {
    const frameInput = frameInputs[index]

    if (!frameInput) continue

    // A tile resize plus draw uses two of the 10 allowed transformations.
    if (tilesInPass === MAX_CONTACT_SHEET_TILES_PER_PASS) {
      const intermediate = await transformer.output({ format: 'image/png' })
      transformer = env.IMAGES.input(intermediate.image())
      tilesInPass = 0
    }

    transformer = transformer.draw(
      env.IMAGES.input(arrayBufferToStream(frameInput)).transform({
        width: TILE_WIDTH,
        height: TILE_HEIGHT,
        fit: 'cover',
      }),
      {
        left: (index % CONTACT_SHEET_COLUMNS) * TILE_WIDTH,
        top: Math.floor(index / CONTACT_SHEET_COLUMNS) * TILE_HEIGHT,
      },
    )
    tilesInPass += 1
  }

  if (rows !== CONTACT_SHEET_ROWS.hour) {
    if (tilesInPass === MAX_CONTACT_SHEET_TILES_PER_PASS) {
      const intermediate = await transformer.output({ format: 'image/png' })
      transformer = env.IMAGES.input(intermediate.image())
    }

    transformer = transformer.transform({
      width: CONTACT_SHEET_WIDTH,
      height: rows * TILE_HEIGHT,
      fit: 'cover',
      gravity: 'top',
    })
  }

  return transformer.output({
    format: 'image/jpeg',
    quality: 85,
  })
}

const renderContactSheet = async (
  env: Bindings,
  deviceId: string,
  windowBeginAt: Date,
  unit: SamplingUnit,
  key: string,
  sheetIndex: number,
  samples: FrameSample[],
  rows: number,
) => {
  const frameInputs: (ArrayBuffer | null)[] = []
  let sourceBytes = 0

  // Consume each R2 body before opening the next connection.
  for (const sample of samples) {
    if (!sample.frame) {
      frameInputs.push(null)
      continue
    }

    const frameObject = await env.BUCKET.get(sample.frame.key)

    if (!frameObject) {
      frameInputs.push(null)
      continue
    }

    sourceBytes += frameObject.size

    if (sourceBytes > MAX_CONTACT_SHEET_SOURCE_BYTES) {
      await frameObject.body.cancel()
      throw new Error(
        `Contact sheet source images exceed ${MAX_CONTACT_SHEET_SOURCE_BYTES} bytes`,
      )
    }

    frameInputs.push(await frameObject.arrayBuffer())
  }

  const result = await composeContactSheetImage(env, frameInputs, rows)
  const selectedCount = frameInputs.filter((frame) => frame !== null).length

  await env.BUCKET.put(key, result.image(), {
    httpMetadata: {
      contentType: result.contentType(),
    },
    customMetadata: {
      beginAt: windowBeginAt.toISOString(),
      deviceId,
      kind: unit === 'hour' ? 'hourly-contact-sheet' : 'minute-contact-sheet',
      schemaVersion: String(CONTACT_SHEET_SCHEMA_VERSION),
      sheetIndex: String(sheetIndex),
      sheetBeginAt: samples[0].targetAt,
    },
  })

  return {
    index: sheetIndex,
    number: sheetIndex + 1,
    key,
    rows,
    columns: CONTACT_SHEET_COLUMNS,
    width: CONTACT_SHEET_WIDTH,
    height: rows * TILE_HEIGHT,
    selectedCount,
    slots: samples.map((sample, index) => {
      const hasFrame = sample.frame !== null && Boolean(frameInputs[index])

      return {
        slot: sample.slot,
        row: Math.floor(index / CONTACT_SHEET_COLUMNS),
        column: index % CONTACT_SHEET_COLUMNS,
        targetAt: sample.targetAt,
        slotEndAt: sample.slotEndAt,
        capturedAt: hasFrame ? sample.frame?.capturedAt ?? null : null,
        capturedAtLocal: hasFrame
          ? sample.frame?.capturedAtLocal ?? null
          : null,
        deltaMs: hasFrame ? sample.deltaMs : null,
        status: hasFrame ? ('captured' as const) : ('missing' as const),
        timezone: hasFrame ? sample.frame?.timezone ?? null : null,
      }
    }),
  }
}

export const buildContactSheets = async (
  env: Bindings,
  deviceId: string,
  beginAt: Date,
  unit: SamplingUnit,
) => {
  const layout = samplingLayouts[unit]
  const endAt = new Date(beginAt.getTime() + layout.durationMs)
  const contactSheetLayout = contactSheetLayouts[unit]
  const rows = contactSheetLayout.rows
  const sheetSlotCount = contactSheetLayout.slotsPerSheet
  const outputPrefix = buildContactSheetPrefix(deviceId, beginAt, unit)
  const manifestKey = `${outputPrefix}manifest.json`
  const existingManifest = await env.BUCKET.head(manifestKey)

  if (existingManifest) {
    return {
      status: 'already-built' as const,
      manifestKey,
    }
  }

  const frames = await listFrames(
    env.BUCKET,
    buildImagePrefix(deviceId, beginAt, unit),
  )
  const samples = sampleFrames(frames, {
    beginAt,
    endAt,
    rows: layout.rows,
    columns: layout.columns,
    toleranceMs: layout.toleranceMs,
  })

  if (unit === 'minute' && frames.length === 0) {
    return {
      status: 'no-frames' as const,
      manifestKey,
    }
  }

  const sheetCount = Math.ceil(samples.length / sheetSlotCount)
  const generationPrefix = `${outputPrefix}generations/${crypto.randomUUID()}/`
  const sheets: ContactSheetManifest['sheets'] = []
  let published = false

  try {
    for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
      const firstSlot = sheetIndex * sheetSlotCount
      const sheetSamples = samples.slice(
        firstSlot,
        firstSlot + sheetSlotCount,
      )
      const key = `${generationPrefix}sheet-${String(sheetIndex + 1).padStart(2, '0')}.jpg`

      sheets.push(
        await renderContactSheet(
          env,
          deviceId,
          beginAt,
          unit,
          key,
          sheetIndex,
          sheetSamples,
          rows,
        ),
      )
    }

    const generatedAt = new Date().toISOString()
    const selectedCount = sheets.reduce(
      (total, sheet) => total + sheet.selectedCount,
      0,
    )
    const manifest: ContactSheetManifest = {
      schemaVersion: CONTACT_SHEET_SCHEMA_VERSION,
      type: unit === 'hour' ? 'hourly-contact-sheets' : 'minute-contact-sheets',
      deviceId,
      unit,
      beginAt: beginAt.toISOString(),
      endAt: endAt.toISOString(),
      generatedAt,
      candidateCount: frames.length,
      selectedCount,
      sampling: {
        slotCount: samples.length,
        toleranceMs: layout.toleranceMs,
      },
      layout: {
        order: 'row-major',
        origin: 'top-left',
        tileWidth: TILE_WIDTH,
        tileHeight: TILE_HEIGHT,
        rows,
        columns: CONTACT_SHEET_COLUMNS,
        width: CONTACT_SHEET_WIDTH,
        height: rows * TILE_HEIGHT,
        sheetCount,
      },
      sheets,
    }

    const storedManifest = await env.BUCKET.put(
      manifestKey,
      JSON.stringify(manifest),
      {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: {
          contentType: 'application/json; charset=utf-8',
        },
        customMetadata: {
          beginAt: beginAt.toISOString(),
          deviceId,
          kind:
            unit === 'hour'
              ? 'hourly-contact-sheet-manifest'
              : 'minute-contact-sheet-manifest',
          schemaVersion: String(CONTACT_SHEET_SCHEMA_VERSION),
        },
      },
    )

    if (!storedManifest) {
      return {
        status: 'already-built' as const,
        manifestKey,
      }
    }

    published = true

    return {
      status: 'built' as const,
      manifestKey,
      candidateCount: frames.length,
      selectedCount,
      sheetCount,
    }
  } finally {
    if (!published && sheets.length > 0) {
      try {
        await env.BUCKET.delete(sheets.map((sheet) => sheet.key))
      } catch (error) {
        console.warn('Failed to clean up unpublished contact sheets', {
          generationPrefix,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}

export const readContactSheetManifest = async (
  bucket: R2Bucket,
  deviceId: string,
  beginAt: Date,
  unit: SamplingUnit,
) => {
  const manifestKey = `${buildContactSheetPrefix(deviceId, beginAt, unit)}manifest.json`
  const manifestObject = await bucket.get(manifestKey)

  if (!manifestObject) return null

  let value: unknown
  try {
    value = JSON.parse(await manifestObject.text())
  } catch {
    throw new Error(`Contact sheet manifest is not valid JSON: ${manifestKey}`)
  }

  const parsed = contactSheetManifestSchema.safeParse(value)

  if (!parsed.success) {
    throw new Error(`Contact sheet manifest has an invalid schema: ${manifestKey}`)
  }

  if (
    parsed.data.deviceId !== deviceId ||
    parsed.data.unit !== unit ||
    parsed.data.beginAt !== beginAt.toISOString() ||
    parsed.data.type !==
      (unit === 'hour' ? 'hourly-contact-sheets' : 'minute-contact-sheets') ||
    parsed.data.layout.sheetCount !== parsed.data.sheets.length
  ) {
    throw new Error(`Contact sheet manifest does not match its key: ${manifestKey}`)
  }

  return parsed.data
}

export const enqueuePreviousHourContactSheets = async (
  controller: ScheduledController,
  env: Bindings,
) => {
  const beginAt = getPreviousHourBeginAt(controller.scheduledTime)
  const deviceIds = await listActiveDeviceIds(env.DB)
  const jobs: ContactSheetBuildJob[] = deviceIds.map((deviceId) => ({
    version: CONTACT_SHEET_SCHEMA_VERSION,
    type: 'build-hourly-contact-sheets',
    deviceId,
    beginAt: beginAt.toISOString(),
  }))

  for (let index = 0; index < jobs.length; index += QUEUE_SEND_BATCH_SIZE) {
    const messages: MessageSendRequest<ContactSheetBuildJob>[] = jobs
      .slice(index, index + QUEUE_SEND_BATCH_SIZE)
      .map((body) => ({ body, contentType: 'json' }))

    await env.CONTACT_SHEET_BUILDER_QUEUE.sendBatch(messages)
  }

  console.log('Enqueued hourly contact sheet jobs', {
    beginAt: beginAt.toISOString(),
    deviceCount: jobs.length,
  })
}

export const consumeContactSheetJobs = async (
  batch: MessageBatch<ContactSheetBuildJob>,
  env: Bindings,
): Promise<void> => {
  for (const message of batch.messages) {
    try {
      const { deviceId, beginAt } = parseContactSheetBuildJob(message.body)

      if (!(await activeDeviceExists(env.DB, deviceId))) {
        console.warn('Skipped contact sheet job for unavailable device', {
          messageId: message.id,
          deviceId,
          beginAt: beginAt.toISOString(),
        })
        message.ack()
        continue
      }

      const result = await buildContactSheets(env, deviceId, beginAt, 'hour')

      console.log('Built hourly contact sheets', {
        messageId: message.id,
        attempts: message.attempts,
        deviceId,
        beginAt: beginAt.toISOString(),
        ...result,
      })
      message.ack()
    } catch (error) {
      console.error('Failed to build hourly contact sheets', {
        messageId: message.id,
        attempts: message.attempts,
        job: message.body,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
      })
      message.retry()
    }
  }
}
