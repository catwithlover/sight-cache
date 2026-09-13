export type AccessDevice = {
  id: string
  name: string
  lastFrameAt: string | null
}

type DeviceTokenRow = {
  id: string
  name: string
  last_frame_at: string | null
  token_id: string
  token_last_used_at: string | null
}

const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000
const LAST_FRAME_UPDATE_INTERVAL_MS = 5 * 1000

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export const getDeviceByToken = async (
  db: D1Database,
  token: string,
): Promise<AccessDevice | null> => {
  const secretHash = await sha256(token)
  const row = await db
    .prepare(
      `SELECT
         d.id,
         d.name,
         d.last_frame_at,
         t.id AS token_id,
         t.last_used_at AS token_last_used_at
       FROM device_tokens AS t
       INNER JOIN devices AS d ON d.id = t.device_id
       WHERE t.secret_hash = ?1
         AND t.revoked_at IS NULL
         AND d.disabled_at IS NULL
       LIMIT 1`,
    )
    .bind(secretHash)
    .first<DeviceTokenRow>()

  if (!row) return null

  const now = new Date()
  const lastUsedAt = row.token_last_used_at
    ? Date.parse(row.token_last_used_at)
    : Number.NaN

  if (
    !Number.isFinite(lastUsedAt) ||
    now.getTime() - lastUsedAt >= LAST_USED_UPDATE_INTERVAL_MS
  ) {
    const cutoff = new Date(
      now.getTime() - LAST_USED_UPDATE_INTERVAL_MS,
    ).toISOString()

    await db
      .prepare(
        `UPDATE device_tokens
         SET last_used_at = ?1
         WHERE id = ?2
           AND revoked_at IS NULL
           AND (last_used_at IS NULL OR last_used_at <= ?3)`,
      )
      .bind(now.toISOString(), row.token_id, cutoff)
      .run()
  }

  return {
    id: row.id,
    name: row.name,
    lastFrameAt: row.last_frame_at,
  }
}

export const updateDeviceLastFrameAt = async (
  db: D1Database,
  device: AccessDevice,
  storedAt: Date,
) => {
  const storedAtTime = storedAt.getTime()
  const previousLastFrameAt = device.lastFrameAt
    ? Date.parse(device.lastFrameAt)
    : Number.NaN

  if (
    Number.isFinite(previousLastFrameAt) &&
    storedAtTime - previousLastFrameAt < LAST_FRAME_UPDATE_INTERVAL_MS
  ) {
    return
  }

  const cutoff = new Date(
    storedAtTime - LAST_FRAME_UPDATE_INTERVAL_MS,
  ).toISOString()

  await db
    .prepare(
      `UPDATE devices
       SET last_frame_at = ?1
       WHERE id = ?2
         AND disabled_at IS NULL
         AND (last_frame_at IS NULL OR last_frame_at <= ?3)`,
    )
    .bind(storedAt.toISOString(), device.id, cutoff)
    .run()
}
