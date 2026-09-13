export type SamplingUnit = 'minute' | 'hour'

export type FrameRef = {
  key: string
  capturedAt: string
  capturedAtMs: number
  size: number
}

export type FrameSample = {
  slot: number
  row: number
  column: number
  targetAt: string
  slotEndAt: string
  frame: FrameRef | null
  deltaMs: number | null
}

export type SampleFramesOptions = {
  beginAt: Date
  endAt: Date
  rows: number
  columns: number
  toleranceMs?: number
}

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 60 * MS_PER_MINUTE

export const deviceIdPattern =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu

export const samplingLayouts = {
  minute: {
    durationMs: MS_PER_MINUTE,
    rows: 3,
    columns: 4,
    toleranceMs: 5_000,
  },
  hour: {
    durationMs: MS_PER_HOUR,
    rows: 6,
    columns: 10,
    toleranceMs: 10_000,
  },
} satisfies Record<
  SamplingUnit,
  {
    durationMs: number
    rows: number
    columns: number
    toleranceMs: number
  }
>

export const isSamplingUnit = (
  value: string | undefined,
): value is SamplingUnit => value === 'minute' || value === 'hour'

export const isAlignedSamplingBeginAt = (
  beginAt: Date,
  unit: SamplingUnit,
) =>
  Number.isFinite(beginAt.getTime()) &&
  beginAt.getUTCMilliseconds() === 0 &&
  beginAt.getUTCSeconds() === 0 &&
  (unit === 'minute' || beginAt.getUTCMinutes() === 0)

export const buildImagePrefix = (
  deviceId: string,
  beginAt: Date,
  unit: SamplingUnit,
) => {
  const dateTime = beginAt.toISOString()

  const segments = [
    'frames',
    deviceId,
    dateTime.slice(0, 4),
    dateTime.slice(5, 7),
    dateTime.slice(8, 10),
    dateTime.slice(11, 13),
    unit === 'minute' ? dateTime.slice(14, 16) : null,
  ]

  return `${segments.filter((segment) => segment !== null).join('/')}/`
}

export const buildImageKey = (deviceId: string, capturedAt: Date) => {
  const dateTime = capturedAt.toISOString()
  const pathTimestamp = dateTime
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.000', '')

  return [
    buildImagePrefix(deviceId, capturedAt, 'minute'),
    `${pathTimestamp}.jpg`,
  ].join('')
}

export const listFrames = async (bucket: R2Bucket, prefix: string) => {
  const frames: FrameRef[] = []
  let cursor: string | undefined
  let invalidMetadataCount = 0

  do {
    const result = await bucket.list({
      cursor,
      include: ['customMetadata'],
      limit: 1000,
      prefix,
    })

    for (const object of result.objects) {
      const capturedAt = object.customMetadata?.capturedAt
      const capturedAtMs = capturedAt ? Date.parse(capturedAt) : Number.NaN

      if (!capturedAt || !Number.isFinite(capturedAtMs)) {
        invalidMetadataCount += 1
        continue
      }

      frames.push({
        key: object.key,
        capturedAt: new Date(capturedAtMs).toISOString(),
        capturedAtMs,
        size: object.size,
      })
    }

    cursor = result.truncated ? result.cursor : undefined
  } while (cursor)

  if (invalidMetadataCount > 0) {
    console.warn(
      `Skipped ${invalidMetadataCount} frame(s) with invalid capturedAt metadata`,
    )
  }

  return frames.sort((left, right) => left.capturedAtMs - right.capturedAtMs)
}

export const listFramesInRange = async (
  bucket: R2Bucket,
  deviceId: string,
  beginAt: Date,
  endAt: Date,
) => {
  const minuteDurationMs = samplingLayouts.minute.durationMs
  const beginAtMs = beginAt.getTime()
  const endAtMs = endAt.getTime()
  const frames: FrameRef[] = []
  let minuteAtMs = Math.floor(beginAtMs / minuteDurationMs) * minuteDurationMs

  while (minuteAtMs < endAtMs) {
    const minuteAt = new Date(minuteAtMs)
    const minuteFrames = await listFrames(
      bucket,
      buildImagePrefix(deviceId, minuteAt, 'minute'),
    )

    frames.push(
      ...minuteFrames.filter(
        (frame) =>
          frame.capturedAtMs >= beginAtMs && frame.capturedAtMs < endAtMs,
      ),
    )
    minuteAtMs += minuteDurationMs
  }

  return frames.sort((left, right) => left.capturedAtMs - right.capturedAtMs)
}

export const sampleFrames = (
  frames: FrameRef[],
  options: SampleFramesOptions,
): FrameSample[] => {
  const beginAtMs = options.beginAt.getTime()
  const endAtMs = options.endAt.getTime()

  if (
    !Number.isFinite(beginAtMs) ||
    !Number.isFinite(endAtMs) ||
    endAtMs <= beginAtMs
  ) {
    throw new Error('Sampling range must contain valid ascending dates')
  }

  if (
    !Number.isInteger(options.rows) ||
    !Number.isInteger(options.columns) ||
    options.rows <= 0 ||
    options.columns <= 0
  ) {
    throw new Error('Sampling rows and columns must be positive integers')
  }

  const slotCount = options.rows * options.columns
  const rangeDurationMs = endAtMs - beginAtMs
  const slotDurationMs = rangeDurationMs / slotCount
  const toleranceMs = Math.min(
    options.toleranceMs ?? slotDurationMs,
    slotDurationMs,
  )

  if (!Number.isFinite(toleranceMs) || toleranceMs < 0) {
    throw new Error('Sampling tolerance must be a non-negative number')
  }

  const samples: FrameSample[] = []
  let frameIndex = 0

  for (let slot = 0; slot < slotCount; slot += 1) {
    const slotBeginAtMs = beginAtMs + (rangeDurationMs * slot) / slotCount
    const slotEndAtMs =
      slot === slotCount - 1
        ? endAtMs
        : beginAtMs + (rangeDurationMs * (slot + 1)) / slotCount

    while (
      frameIndex < frames.length &&
      frames[frameIndex].capturedAtMs < slotBeginAtMs
    ) {
      frameIndex += 1
    }

    const candidate = frames[frameIndex]
    const deltaMs = candidate
      ? candidate.capturedAtMs - slotBeginAtMs
      : null
    const matches =
      candidate !== undefined &&
      candidate.capturedAtMs < slotEndAtMs &&
      deltaMs !== null &&
      deltaMs <= toleranceMs

    samples.push({
      slot,
      row: Math.floor(slot / options.columns),
      column: slot % options.columns,
      targetAt: new Date(slotBeginAtMs).toISOString(),
      slotEndAt: new Date(slotEndAtMs).toISOString(),
      frame: matches ? candidate : null,
      deltaMs: matches ? deltaMs : null,
    })
  }

  return samples
}
