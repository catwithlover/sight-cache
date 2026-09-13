import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  createDevice,
  disableDevice,
  listDevices,
  rotateDeviceToken,
} from '../src/admin.ts'
import {
  authenticateDeviceToken,
  updateDeviceLastFrameAt,
} from '../src/ingest.ts'
import {
  activeDeviceExists,
  getActiveDevice,
  listActiveDeviceIds,
  listActiveDevices,
} from '../src/read.ts'

const normalizeSql = (sql) => sql.replace(/\s+/gu, ' ').trim()

const createDatabase = ({ firstResults = [], allResults = [] } = {}) => {
  const calls = []
  const batches = []
  const first = [...firstResults]
  const all = [...allResults]

  const db = {
    prepare(sql) {
      const call = { sql: normalizeSql(sql), binds: [] }
      calls.push(call)

      const statement = {
        bind(...values) {
          call.binds = values
          return statement
        },
        async first() {
          return first.shift() ?? null
        },
        async all() {
          return { results: all.shift() ?? [] }
        },
        async run() {
          return { success: true }
        },
      }

      return statement
    },
    async batch(statements) {
      batches.push(statements)
      return statements.map(() => ({ success: true }))
    },
  }

  return { db, calls, batches }
}

const activeDeviceRow = {
  id: '01234567-89ab-4def-8123-456789abcdef',
  name: 'Camera 1',
  created_at: '2026-09-13T10:00:00.000Z',
  updated_at: '2026-09-13T10:30:00.000Z',
  disabled_at: null,
  last_frame_at: '2026-09-13T10:29:00.000Z',
  token_id: 'token-id',
  token_hint: 'scd_token...hint',
  token_created_at: '2026-09-13T10:00:00.000Z',
  token_last_used_at: '2026-09-13T10:28:00.000Z',
}

test('maps admin devices and selects only the current token', async () => {
  const { db, calls } = createDatabase({ allResults: [[activeDeviceRow]] })

  assert.deepEqual(await listDevices(db), [
    {
      id: activeDeviceRow.id,
      name: activeDeviceRow.name,
      createdAt: activeDeviceRow.created_at,
      updatedAt: activeDeviceRow.updated_at,
      disabledAt: null,
      lastFrameAt: activeDeviceRow.last_frame_at,
      token: {
        id: activeDeviceRow.token_id,
        hint: activeDeviceRow.token_hint,
        createdAt: activeDeviceRow.token_created_at,
        lastUsedAt: activeDeviceRow.token_last_used_at,
      },
    },
  ])
  assert.match(calls[0].sql, /t\.revoked_at IS NULL/u)
  assert.match(calls[0].sql, /CASE WHEN d\.disabled_at IS NULL/u)
})

test('creates a device and credential in one batch without storing the raw token', async () => {
  const { db, calls, batches } = createDatabase()
  const result = await createDevice(db, 'Camera 1')

  assert.match(
    result.token,
    /^scd_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/u,
  )
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 2)
  assert.match(calls[0].sql, /^INSERT INTO devices/u)
  assert.match(calls[1].sql, /^INSERT INTO device_tokens/u)
  assert.equal(calls.flatMap((call) => call.binds).includes(result.token), false)
  assert.equal(
    calls[1].binds[2],
    createHash('sha256').update(result.token).digest('hex'),
  )
  assert.equal(result.device.token.hint, calls[1].binds[3])
})

test('rotates an active device token in one ordered batch', async () => {
  const { db, calls, batches } = createDatabase({
    firstResults: [{ id: activeDeviceRow.id, disabled_at: null }],
  })

  const result = await rotateDeviceToken(db, activeDeviceRow.id)

  assert.equal(result.kind, 'ok')
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 3)
  assert.match(calls[1].sql, /^UPDATE device_tokens SET revoked_at/u)
  assert.match(calls[2].sql, /^INSERT INTO device_tokens/u)
  assert.match(calls[3].sql, /^UPDATE devices SET updated_at/u)
  assert.equal(calls[1].binds[1], activeDeviceRow.id)
  assert.equal(calls[2].binds[1], activeDeviceRow.id)
})

test('does not rotate a disabled device token', async () => {
  const { db, calls, batches } = createDatabase({
    firstResults: [
      { id: activeDeviceRow.id, disabled_at: '2026-09-13T11:00:00.000Z' },
    ],
  })

  assert.deepEqual(await rotateDeviceToken(db, activeDeviceRow.id), {
    kind: 'disabled',
  })
  assert.equal(calls.length, 1)
  assert.equal(batches.length, 0)
})

test('disables a device and revokes its active token in one batch', async () => {
  const { db, calls, batches } = createDatabase({
    firstResults: [{ id: activeDeviceRow.id, disabled_at: null }],
  })

  assert.equal(await disableDevice(db, activeDeviceRow.id), 'disabled')
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 2)
  assert.match(calls[1].sql, /SET disabled_at = \?1, updated_at = \?1/u)
  assert.match(calls[2].sql, /revoked_at IS NULL/u)
})

test('authenticates only an enabled device with an active token', async () => {
  const token = 'test-collector-token'
  const { db, calls } = createDatabase({
    firstResults: [
      {
        id: activeDeviceRow.id,
        name: activeDeviceRow.name,
        last_frame_at: activeDeviceRow.last_frame_at,
        token_id: activeDeviceRow.token_id,
        token_last_used_at: new Date().toISOString(),
      },
    ],
  })

  assert.deepEqual(await authenticateDeviceToken(db, token), {
    id: activeDeviceRow.id,
    name: activeDeviceRow.name,
    lastFrameAt: activeDeviceRow.last_frame_at,
  })
  assert.match(calls[0].sql, /t\.revoked_at IS NULL/u)
  assert.match(calls[0].sql, /d\.disabled_at IS NULL/u)
  assert.equal(
    calls[0].binds[0],
    createHash('sha256').update(token).digest('hex'),
  )
  assert.equal(calls.length, 1)
})

test('touches stale token activity with a conditional update', async () => {
  const before = Date.now()
  const { db, calls } = createDatabase({
    firstResults: [
      {
        id: activeDeviceRow.id,
        name: activeDeviceRow.name,
        last_frame_at: null,
        token_id: activeDeviceRow.token_id,
        token_last_used_at: null,
      },
    ],
  })

  await authenticateDeviceToken(db, 'test-collector-token')
  const after = Date.now()

  assert.equal(calls.length, 2)
  assert.match(calls[1].sql, /revoked_at IS NULL/u)
  assert.match(calls[1].sql, /last_used_at IS NULL OR last_used_at <= \?3/u)
  assert.equal(calls[1].binds[1], activeDeviceRow.token_id)
  const touchedAt = Date.parse(calls[1].binds[0])
  assert(touchedAt >= before && touchedAt <= after)
  assert.equal(touchedAt - Date.parse(calls[1].binds[2]), 5 * 60 * 1000)
})

test('throttles device frame activity and protects the write with a cutoff', async () => {
  const storedAt = new Date('2026-09-13T12:00:05.000Z')
  const recent = {
    id: activeDeviceRow.id,
    name: activeDeviceRow.name,
    lastFrameAt: '2026-09-13T12:00:01.000Z',
  }
  const skipped = createDatabase()

  await updateDeviceLastFrameAt(skipped.db, recent, storedAt)
  assert.equal(skipped.calls.length, 0)

  const boundary = createDatabase()
  await updateDeviceLastFrameAt(
    boundary.db,
    { ...recent, lastFrameAt: '2026-09-13T12:00:00.000Z' },
    storedAt,
  )
  assert.match(boundary.calls[0].sql, /disabled_at IS NULL/u)
  assert.deepEqual(boundary.calls[0].binds, [
    '2026-09-13T12:00:05.000Z',
    activeDeviceRow.id,
    '2026-09-13T12:00:00.000Z',
  ])
})

test('maps active device reads while preserving their projections', async () => {
  const row = {
    id: activeDeviceRow.id,
    name: activeDeviceRow.name,
    last_frame_at: activeDeviceRow.last_frame_at,
  }
  const listed = createDatabase({ allResults: [[row]] })
  const found = createDatabase({ firstResults: [row] })

  assert.deepEqual(await listActiveDevices(listed.db), [
    {
      id: row.id,
      name: row.name,
      lastFrameAt: row.last_frame_at,
    },
  ])
  assert.deepEqual(await getActiveDevice(found.db, row.id), {
    id: row.id,
    name: row.name,
    lastFrameAt: row.last_frame_at,
  })
  assert.match(listed.calls[0].sql, /ORDER BY lower\(name\), created_at DESC/u)
  assert.deepEqual(found.calls[0].binds, [row.id])
})

test('uses ID-only active device queries for scheduling and queue gates', async () => {
  const listed = createDatabase({
    allResults: [[{ id: activeDeviceRow.id }, { id: 'second-device' }]],
  })
  const found = createDatabase({
    firstResults: [{ id: activeDeviceRow.id }],
  })
  const missing = createDatabase({ firstResults: [null] })

  assert.deepEqual(await listActiveDeviceIds(listed.db), [
    activeDeviceRow.id,
    'second-device',
  ])
  assert.equal(await activeDeviceExists(found.db, activeDeviceRow.id), true)
  assert.equal(await activeDeviceExists(missing.db, activeDeviceRow.id), false)
  assert.match(listed.calls[0].sql, /^SELECT id FROM devices/u)
  assert.match(listed.calls[0].sql, /ORDER BY id$/u)
  assert.match(found.calls[0].sql, /disabled_at IS NULL$/u)
})
