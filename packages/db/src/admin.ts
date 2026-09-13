import {
  createDeviceCredential,
  type DeviceCredential,
} from '#token'

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

const getDeviceState = (db: D1Database, id: string) =>
  db
    .prepare('SELECT id, disabled_at FROM devices WHERE id = ?1')
    .bind(id)
    .first<DeviceStateRow>()

const insertDeviceToken = (
  db: D1Database,
  credential: DeviceCredential,
  deviceId: string,
  createdAt: string,
) =>
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
      createdAt,
    )

const revokeActiveDeviceToken = (
  db: D1Database,
  deviceId: string,
  revokedAt: string,
) =>
  db
    .prepare(
      `UPDATE device_tokens
       SET revoked_at = ?1
       WHERE device_id = ?2 AND revoked_at IS NULL`,
    )
    .bind(revokedAt, deviceId)

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
  const credential = await createDeviceCredential()

  await db.batch([
    db
      .prepare(
        `INSERT INTO devices (id, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)`,
      )
      .bind(id, name, now),
    insertDeviceToken(db, credential, id, now),
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
  const credential = await createDeviceCredential()

  await db.batch([
    revokeActiveDeviceToken(db, deviceId, now),
    insertDeviceToken(db, credential, deviceId, now),
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
    revokeActiveDeviceToken(db, deviceId, now),
  ])

  return 'disabled'
}
