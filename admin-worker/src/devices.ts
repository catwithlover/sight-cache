import { z } from 'zod'

export const createDeviceInputSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, '請輸入設備名稱')
    .max(80, '設備名稱不可超過 80 個字元'),
})

export const deviceIdSchema = z.uuid()

export type Device = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  disabledAt: string | null
  lastFrameAt: string | null
  token: {
    id: string
    hint: string
    createdAt: string
    lastUsedAt: string | null
  } | null
}

type DeviceRow = {
  id: string
  name: string
  created_at: string
  updated_at: string
  disabled_at: string | null
  last_frame_at: string | null
  token_id: string | null
  token_hint: string | null
  token_created_at: string | null
  token_last_used_at: string | null
}

type DeviceStateRow = {
  id: string
  disabled_at: string | null
}

type DeviceCredential = {
  id: string
  raw: string
  hash: string
  hint: string
}

export type TokenResult =
  | { kind: 'ok'; token: string; tokenHint: string }
  | { kind: 'not_found' }
  | { kind: 'disabled' }

export type DisableResult = 'disabled' | 'already_disabled' | 'not_found'

const deviceSelect = `
  SELECT
    d.id,
    d.name,
    d.created_at,
    d.updated_at,
    d.disabled_at,
    d.last_frame_at,
    t.id AS token_id,
    t.token_hint,
    t.created_at AS token_created_at,
    t.last_used_at AS token_last_used_at
  FROM devices AS d
  LEFT JOIN device_tokens AS t
    ON t.device_id = d.id
    AND t.revoked_at IS NULL
`

const toDevice = (row: DeviceRow): Device => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  disabledAt: row.disabled_at,
  lastFrameAt: row.last_frame_at,
  token:
    row.token_id && row.token_hint && row.token_created_at
      ? {
          id: row.token_id,
          hint: row.token_hint,
          createdAt: row.token_created_at,
          lastUsedAt: row.token_last_used_at,
        }
      : null,
})

const base64UrlEncode = (bytes: Uint8Array) => {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

const createCredential = async (): Promise<DeviceCredential> => {
  const id = crypto.randomUUID()
  const secretBytes = new Uint8Array(32)
  crypto.getRandomValues(secretBytes)
  const secret = base64UrlEncode(secretBytes)
  const raw = `scd_${id}.${secret}`

  return {
    id,
    raw,
    hash: await sha256(raw),
    hint: `scd_${id.slice(0, 8)}...${secret.slice(-6)}`,
  }
}

const getDeviceState = (db: D1Database, id: string) =>
  db
    .prepare('SELECT id, disabled_at FROM devices WHERE id = ?1')
    .bind(id)
    .first<DeviceStateRow>()

export const listDevices = async (db: D1Database) => {
  const result = await db
    .prepare(
      `${deviceSelect}
       ORDER BY
         CASE WHEN d.disabled_at IS NULL THEN 0 ELSE 1 END,
         lower(d.name),
         d.created_at DESC`,
    )
    .all<DeviceRow>()

  return result.results.map(toDevice)
}

export const createDevice = async (db: D1Database, name: string) => {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const credential = await createCredential()

  await db.batch([
    db
      .prepare(
        `INSERT INTO devices (id, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)`,
      )
      .bind(id, name, now),
    db
      .prepare(
        `INSERT INTO device_tokens (
           id,
           device_id,
           secret_hash,
           token_hint,
           created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(credential.id, id, credential.hash, credential.hint, now),
  ])

  const device: Device = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    disabledAt: null,
    lastFrameAt: null,
    token: {
      id: credential.id,
      hint: credential.hint,
      createdAt: now,
      lastUsedAt: null,
    },
  }

  return { device, token: credential.raw }
}

export const rotateDeviceToken = async (
  db: D1Database,
  deviceId: string,
): Promise<TokenResult> => {
  const device = await getDeviceState(db, deviceId)
  if (!device) return { kind: 'not_found' }
  if (device.disabled_at) return { kind: 'disabled' }

  const now = new Date().toISOString()
  const credential = await createCredential()

  await db.batch([
    db
      .prepare(
        `UPDATE device_tokens
         SET revoked_at = ?1
         WHERE device_id = ?2 AND revoked_at IS NULL`,
      )
      .bind(now, deviceId),
    db
      .prepare(
        `INSERT INTO device_tokens (
           id,
           device_id,
           secret_hash,
           token_hint,
           created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        credential.id,
        deviceId,
        credential.hash,
        credential.hint,
        now,
      ),
    db
      .prepare('UPDATE devices SET updated_at = ?1 WHERE id = ?2')
      .bind(now, deviceId),
  ])

  return {
    kind: 'ok',
    token: credential.raw,
    tokenHint: credential.hint,
  }
}

export const disableDevice = async (
  db: D1Database,
  deviceId: string,
): Promise<DisableResult> => {
  const device = await getDeviceState(db, deviceId)
  if (!device) return 'not_found'
  if (device.disabled_at) return 'already_disabled'

  const now = new Date().toISOString()

  await db.batch([
    db
      .prepare(
        `UPDATE devices
         SET disabled_at = ?1, updated_at = ?1
         WHERE id = ?2`,
      )
      .bind(now, deviceId),
    db
      .prepare(
        `UPDATE device_tokens
         SET revoked_at = ?1
         WHERE device_id = ?2 AND revoked_at IS NULL`,
      )
      .bind(now, deviceId),
  ])

  return 'disabled'
}
