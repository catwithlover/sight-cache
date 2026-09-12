import {
  buildImagePrefix,
  deviceIdPattern,
  listFrames,
  sampleFrames,
  samplingLayouts,
  type FrameSample,
} from './frame-sampling'

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
}

type DeviceIdRow = {
  id: string
}

const TILE_WIDTH = 640
const TILE_HEIGHT = 360
const CONTACT_SHEET_COLUMNS = 2
const CONTACT_SHEET_ROWS = 5
const CONTACT_SHEET_SLOT_COUNT =
  CONTACT_SHEET_COLUMNS * CONTACT_SHEET_ROWS
const CONTACT_SHEET_WIDTH = CONTACT_SHEET_COLUMNS * TILE_WIDTH
const CONTACT_SHEET_HEIGHT = CONTACT_SHEET_ROWS * TILE_HEIGHT
const CONTACT_SHEET_BASE_URL = 'https://assets.local/blank.png'
const CONTACT_SHEET_SCHEMA_VERSION = 1
const MAX_CONTACT_SHEET_SOURCE_BYTES = 48 * 1024 * 1024
const QUEUE_SEND_BATCH_SIZE = 100

const arrayBufferToStream = (buffer: ArrayBuffer) =>
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

const buildContactSheetPrefix = (deviceId: string, beginAt: Date) => {
  const dateTime = beginAt.toISOString()

  return [
    'contact-sheets',
    `v${CONTACT_SHEET_SCHEMA_VERSION}`,
    deviceId,
    dateTime.slice(0, 4),
    dateTime.slice(5, 7),
    dateTime.slice(8, 10),
    dateTime.slice(11, 13),
  ].join('/') + '/'
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

const renderContactSheet = async (
  env: Bindings,
  deviceId: string,
  hourBeginAt: Date,
  key: string,
  sheetIndex: number,
  samples: FrameSample[],
) => {
  const baseImage = await env.ASSETS.fetch(CONTACT_SHEET_BASE_URL)

  if (!baseImage.ok || !baseImage.body) {
    throw new Error(
      `Contact sheet base image is unavailable (${baseImage.status})`,
    )
  }

  const baseImageBytes = await baseImage.arrayBuffer()
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

  let transformer = env.IMAGES.input(
    arrayBufferToStream(baseImageBytes),
  ).transform({
    width: CONTACT_SHEET_WIDTH,
    height: CONTACT_SHEET_HEIGHT,
    fit: 'squeeze',
  })
  let selectedCount = 0

  for (let index = 0; index < samples.length; index += 1) {
    const frameInput = frameInputs[index]

    if (!frameInput) continue

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
    selectedCount += 1
  }

  const result = await transformer.output({
    format: 'image/jpeg',
    quality: 85,
  })

  await env.BUCKET.put(key, result.image(), {
    httpMetadata: {
      contentType: result.contentType(),
    },
    customMetadata: {
      beginAt: hourBeginAt.toISOString(),
      deviceId,
      kind: 'hourly-contact-sheet',
      schemaVersion: String(CONTACT_SHEET_SCHEMA_VERSION),
      sheetIndex: String(sheetIndex),
      sheetBeginAt: samples[0].targetAt,
    },
  })

  return {
    index: sheetIndex,
    number: sheetIndex + 1,
    key,
    rows: CONTACT_SHEET_ROWS,
    columns: CONTACT_SHEET_COLUMNS,
    width: CONTACT_SHEET_WIDTH,
    height: CONTACT_SHEET_HEIGHT,
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
        deltaMs: hasFrame ? sample.deltaMs : null,
        status: hasFrame ? 'captured' : 'missing',
      }
    }),
  }
}

const buildHourlyContactSheets = async (
  env: Bindings,
  deviceId: string,
  beginAt: Date,
) => {
  const layout = samplingLayouts.hour
  const endAt = new Date(beginAt.getTime() + layout.durationMs)
  const outputPrefix = buildContactSheetPrefix(deviceId, beginAt)
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
    buildImagePrefix(deviceId, beginAt, 'hour'),
  )
  const samples = sampleFrames(frames, {
    beginAt,
    endAt,
    rows: layout.rows,
    columns: layout.columns,
    toleranceMs: layout.toleranceMs,
  })
  const sheetCount = Math.ceil(samples.length / CONTACT_SHEET_SLOT_COUNT)
  const sheets = []

  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
    const firstSlot = sheetIndex * CONTACT_SHEET_SLOT_COUNT
    const sheetSamples = samples.slice(
      firstSlot,
      firstSlot + CONTACT_SHEET_SLOT_COUNT,
    )
    const key = `${outputPrefix}sheet-${String(sheetIndex + 1).padStart(2, '0')}.jpg`

    sheets.push(
      await renderContactSheet(
        env,
        deviceId,
        beginAt,
        key,
        sheetIndex,
        sheetSamples,
      ),
    )
  }

  const generatedAt = new Date().toISOString()
  const selectedCount = sheets.reduce(
    (total, sheet) => total + sheet.selectedCount,
    0,
  )
  const manifest = {
    schemaVersion: CONTACT_SHEET_SCHEMA_VERSION,
    type: 'hourly-contact-sheets',
    deviceId,
    unit: 'hour',
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
      rows: CONTACT_SHEET_ROWS,
      columns: CONTACT_SHEET_COLUMNS,
      width: CONTACT_SHEET_WIDTH,
      height: CONTACT_SHEET_HEIGHT,
      sheetCount,
    },
    sheets,
  }

  await env.BUCKET.put(manifestKey, JSON.stringify(manifest), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
    },
    customMetadata: {
      beginAt: beginAt.toISOString(),
      deviceId,
      kind: 'hourly-contact-sheet-manifest',
      schemaVersion: String(CONTACT_SHEET_SCHEMA_VERSION),
    },
  })

  return {
    status: 'built' as const,
    manifestKey,
    candidateCount: frames.length,
    selectedCount,
    sheetCount,
  }
}

export const enqueuePreviousHourContactSheets = async (
  controller: ScheduledController,
  env: Bindings,
) => {
  const beginAt = getPreviousHourBeginAt(controller.scheduledTime)
  const result = await env.DB.prepare(
    `SELECT id
     FROM devices
     WHERE disabled_at IS NULL
     ORDER BY id`,
  ).all<DeviceIdRow>()
  const jobs: ContactSheetBuildJob[] = result.results.map((device) => ({
    version: CONTACT_SHEET_SCHEMA_VERSION,
    type: 'build-hourly-contact-sheets',
    deviceId: device.id,
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
      const device = await env.DB.prepare(
        `SELECT id
         FROM devices
         WHERE id = ?1
           AND disabled_at IS NULL`,
      )
        .bind(deviceId)
        .first<DeviceIdRow>()

      if (!device) {
        console.warn('Skipped contact sheet job for unavailable device', {
          messageId: message.id,
          deviceId,
          beginAt: beginAt.toISOString(),
        })
        message.ack()
        continue
      }

      const result = await buildHourlyContactSheets(env, deviceId, beginAt)

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
