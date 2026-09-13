import {
  getActiveDevice as getActiveDeviceRecord,
  listActiveDevices as listActiveDeviceRecords,
  type ActiveDevice as ActiveDeviceRecord,
} from '@sight-cache/db/read'
import {
  buildContactSheets,
  readContactSheetManifest,
  type Bindings,
} from './contact-sheets'
import {
  buildImageKey,
  isAlignedSamplingBeginAt,
  listFramesInRange,
  samplingLayouts,
  type SamplingUnit,
} from './frame-sampling'

export type ActiveDevice = {
  id: string
  name: string
  lastUploadAt: string | null
}

export class ImageAccessError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ImageAccessError'
  }
}

const MAX_MCP_IMAGE_BYTES = 10 * 1024 * 1024
const MINUTE_FINALIZATION_DELAY_MS = 5 * 60_000
const DEFAULT_MAX_LOOKBACK_DAYS = 14
const MAX_FRAME_RANGE_MS = 5 * 60_000
const pendingMinuteBuilds = new Map<string, Promise<void>>()
let minuteBuildQueue = Promise.resolve()

const enqueueMinuteBuild = <T>(build: () => Promise<T>) => {
  const result = minuteBuildQueue.then(build, build)
  minuteBuildQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const toDevice = (device: ActiveDeviceRecord): ActiveDevice => ({
  id: device.id,
  name: device.name,
  lastUploadAt: device.lastFrameAt,
})

export const listActiveDevices = async (db: D1Database) => {
  const devices = await listActiveDeviceRecords(db)
  return devices.map(toDevice)
}

export const getActiveDevice = async (db: D1Database, deviceId: string) => {
  const device = await getActiveDeviceRecord(db, deviceId)
  return device ? toDevice(device) : null
}

export const parseCompletedWindow = (
  value: string,
  unit: SamplingUnit,
  now = Date.now(),
  maxLookbackMs = DEFAULT_MAX_LOOKBACK_DAYS * 24 * 60 * 60_000,
) => {
  const beginAt = new Date(value)

  if (!isAlignedSamplingBeginAt(beginAt, unit)) {
    throw new ImageAccessError(
      'begin_at_unaligned',
      unit === 'hour'
        ? 'beginAt must resolve to the start of a UTC hour.'
        : 'beginAt must resolve to the start of a minute.',
    )
  }

  const endAtMs = beginAt.getTime() + samplingLayouts[unit].durationMs
  const readyAtMs =
    endAtMs + (unit === 'minute' ? MINUTE_FINALIZATION_DELAY_MS : 0)

  if (readyAtMs > now) {
    throw new ImageAccessError(
      'window_not_complete',
      `The requested ${unit} is still being captured. Retry after ${new Date(readyAtMs).toISOString()}.`,
    )
  }

  if (beginAt.getTime() < now - maxLookbackMs) {
    throw new ImageAccessError(
      'window_too_old',
      `The requested window exceeds the configured lookback period.`,
    )
  }

  return beginAt
}

const getMaxLookbackMs = (env: Bindings) => {
  const value = env.MCP_MAX_LOOKBACK_DAYS?.trim()
  if (!value) return DEFAULT_MAX_LOOKBACK_DAYS * 24 * 60 * 60_000

  const days = Number(value)

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new ImageAccessError(
      'lookback_not_configured',
      'MCP_MAX_LOOKBACK_DAYS must be an integer between 1 and 365.',
    )
  }

  return days * 24 * 60 * 60_000
}

const readJpeg = async (object: R2ObjectBody, missingCode: string) => {
  if (object.size > MAX_MCP_IMAGE_BYTES) {
    await object.body.cancel()
    throw new ImageAccessError(
      'image_too_large',
      `The image exceeds the ${MAX_MCP_IMAGE_BYTES}-byte MCP response limit.`,
    )
  }

  const mimeType =
    object.httpMetadata?.contentType?.split(';', 1)[0].trim().toLowerCase() ??
    'image/jpeg'

  if (mimeType !== 'image/jpeg') {
    await object.body.cancel()
    throw new ImageAccessError(
      missingCode,
      'The stored object is not a JPEG image.',
    )
  }

  return {
    bytes: await object.arrayBuffer(),
    mimeType,
    size: object.size,
  }
}

export const getContactSheetImage = async (
  env: Bindings,
  deviceId: string,
  unit: SamplingUnit,
  beginAtValue: string,
  sheetNumber: number,
) => {
  const device = await getActiveDevice(env.DB, deviceId)

  if (!device) {
    throw new ImageAccessError(
      'device_not_found',
      'The active device was not found.',
    )
  }

  const beginAt = parseCompletedWindow(
    beginAtValue,
    unit,
    Date.now(),
    getMaxLookbackMs(env),
  )
  let manifest = await readContactSheetManifest(
    env.BUCKET,
    deviceId,
    beginAt,
    unit,
  )

  if (!manifest && unit === 'minute') {
    const buildKey = `${deviceId}:${beginAt.toISOString()}`
    let pendingBuild = pendingMinuteBuilds.get(buildKey)

    if (!pendingBuild) {
      pendingBuild = enqueueMinuteBuild(() =>
        buildContactSheets(env, deviceId, beginAt, unit),
      )
        .then((buildResult) => {
          if (buildResult.status === 'no-frames') {
            throw new ImageAccessError(
              'frames_not_found',
              'No camera frames were uploaded during that minute.',
            )
          }
        })
        .finally(() => pendingMinuteBuilds.delete(buildKey))
      pendingMinuteBuilds.set(buildKey, pendingBuild)
    }

    await pendingBuild

    manifest = await readContactSheetManifest(
      env.BUCKET,
      deviceId,
      beginAt,
      unit,
    )
  }

  if (!manifest) {
    throw new ImageAccessError(
      'contact_sheet_not_ready',
      unit === 'hour'
        ? 'The scheduled hourly contact sheet is not available yet.'
        : 'The minute contact sheet could not be published.',
    )
  }

  const sheet = manifest.sheets[sheetNumber - 1]

  if (!sheet) {
    throw new ImageAccessError(
      'sheet_number_invalid',
      `sheetNumber must be between 1 and ${manifest.sheets.length}.`,
    )
  }

  const object = await env.BUCKET.get(sheet.key)

  if (!object) {
    throw new ImageAccessError(
      'contact_sheet_incomplete',
      'The contact sheet manifest exists, but its JPEG is missing.',
    )
  }

  return {
    device,
    manifest,
    sheet,
    ...(await readJpeg(object, 'contact_sheet_invalid')),
  }
}

export const listFrameMetadata = async (
  env: Bindings,
  deviceId: string,
  beginAtValue: string,
  endAtValue: string,
  limit: number,
) => {
  const device = await getActiveDevice(env.DB, deviceId)

  if (!device) {
    throw new ImageAccessError(
      'device_not_found',
      'The active device was not found.',
    )
  }

  const beginAt = new Date(beginAtValue)
  const endAt = new Date(endAtValue)
  const beginAtMs = beginAt.getTime()
  const endAtMs = endAt.getTime()
  const now = Date.now()

  if (
    !Number.isFinite(beginAtMs) ||
    !Number.isFinite(endAtMs) ||
    endAtMs <= beginAtMs
  ) {
    throw new ImageAccessError(
      'frame_range_invalid',
      'beginAt and endAt must form an ascending time range.',
    )
  }

  if (endAtMs - beginAtMs > MAX_FRAME_RANGE_MS) {
    throw new ImageAccessError(
      'frame_range_too_large',
      'A frame range must not exceed five minutes.',
    )
  }

  if (endAtMs > now) {
    throw new ImageAccessError(
      'frame_range_future',
      'endAt must not be in the future.',
    )
  }

  if (beginAtMs < now - getMaxLookbackMs(env)) {
    throw new ImageAccessError(
      'frame_range_too_old',
      'The requested range exceeds the configured lookback period.',
    )
  }

  const matches = await listFramesInRange(
    env.BUCKET,
    deviceId,
    beginAt,
    endAt,
  )
  const frames = matches.slice(0, limit)
  const truncated = frames.length < matches.length

  return {
    device,
    beginAt: beginAt.toISOString(),
    endAt: endAt.toISOString(),
    matchingCount: matches.length,
    truncated,
    nextBeginAt:
      truncated && frames.length > 0
        ? new Date(frames.at(-1)!.capturedAtMs + 1).toISOString()
        : null,
    frames: frames.map((frame) => ({
      capturedAt: frame.capturedAt,
      byteSize: frame.size,
      offsetMs: frame.capturedAtMs - beginAtMs,
    })),
  }
}

export const getOriginalFrameImage = async (
  env: Bindings,
  deviceId: string,
  capturedAtValue: string,
) => {
  const device = await getActiveDevice(env.DB, deviceId)

  if (!device) {
    throw new ImageAccessError(
      'device_not_found',
      'The active device was not found.',
    )
  }

  const capturedAt = new Date(capturedAtValue)

  if (
    !Number.isFinite(capturedAt.getTime()) ||
    capturedAt.getUTCMilliseconds() !== 0
  ) {
    throw new ImageAccessError(
      'captured_at_invalid',
      'capturedAt must identify an exact whole-second frame timestamp.',
    )
  }

  if (capturedAt.getTime() > Date.now()) {
    throw new ImageAccessError(
      'captured_at_future',
      'capturedAt must not be in the future.',
    )
  }

  if (capturedAt.getTime() < Date.now() - getMaxLookbackMs(env)) {
    throw new ImageAccessError(
      'frame_too_old',
      'The requested frame exceeds the configured lookback period.',
    )
  }

  const object = await env.BUCKET.get(buildImageKey(deviceId, capturedAt))

  if (!object) {
    throw new ImageAccessError(
      'frame_not_found',
      'No original frame exists at that exact timestamp. Use a capturedAt value returned by get_contact_sheet or list_frames.',
    )
  }

  return {
    device,
    capturedAt: capturedAt.toISOString(),
    ...(await readJpeg(object, 'frame_invalid')),
  }
}

export const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 32 * 1024
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }

  return btoa(binary)
}
