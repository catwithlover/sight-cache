export type ActiveDevice = {
  id: string
  name: string
  lastFrameAt: string | null
}

type DeviceRow = {
  id: string
  name: string
  last_frame_at: string | null
}

type DeviceIdRow = {
  id: string
}

const toDevice = (row: DeviceRow): ActiveDevice => ({
  id: row.id,
  name: row.name,
  lastFrameAt: row.last_frame_at,
})

export const listActiveDevices = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT id, name, last_frame_at
       FROM devices
       WHERE disabled_at IS NULL
       ORDER BY lower(name), created_at DESC`,
    )
    .all<DeviceRow>()

  return result.results.map(toDevice)
}

export const getActiveDevice = async (
  db: D1Database,
  deviceId: string,
) => {
  const row = await db
    .prepare(
      `SELECT id, name, last_frame_at
       FROM devices
       WHERE id = ?1
         AND disabled_at IS NULL`,
    )
    .bind(deviceId)
    .first<DeviceRow>()

  return row ? toDevice(row) : null
}

export const listActiveDeviceIds = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT id
       FROM devices
       WHERE disabled_at IS NULL
       ORDER BY id`,
    )
    .all<DeviceIdRow>()

  return result.results.map((device) => device.id)
}

export const activeDeviceExists = async (
  db: D1Database,
  deviceId: string,
) => {
  const row = await db
    .prepare(
      `SELECT id
       FROM devices
       WHERE id = ?1
         AND disabled_at IS NULL`,
    )
    .bind(deviceId)
    .first<DeviceIdRow>()

  return row !== null
}
