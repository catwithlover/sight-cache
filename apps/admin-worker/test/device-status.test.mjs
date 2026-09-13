import assert from 'node:assert/strict'
import test from 'node:test'
import { getDevicePresence } from '../src/device-status.ts'

const now = Date.parse('2026-09-13T12:00:00.000Z')

const device = (overrides = {}) => ({
  id: '8c66f691-0b13-48d2-bc35-d5aa04b23085',
  name: 'Camera',
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
  disabledAt: null,
  lastFrameAt: null,
  token: {
    id: '540d316a-dfc5-41e7-8b6c-8bb01cb8add2',
    hint: 'scd_540d316a...abc123',
    createdAt: '2026-09-13T10:00:00.000Z',
    lastUsedAt: null,
  },
  ...overrides,
})

test('reports a device with no recorded activity as never connected', () => {
  assert.equal(getDevicePresence(device(), now).status, 'never')
})

test('uses the newer of frame and token activity', () => {
  const presence = getDevicePresence(
    device({
      lastFrameAt: '2026-09-13T11:40:00.000Z',
      token: {
        ...device().token,
        lastUsedAt: '2026-09-13T11:55:00.000Z',
      },
    }),
    now,
  )

  assert.equal(presence.status, 'recent')
  assert.equal(presence.activityAt, '2026-09-13T11:55:00.000Z')
  assert.equal(presence.activitySource, 'token')
})

test('reports stale activity as offline', () => {
  assert.equal(
    getDevicePresence(
      device({ lastFrameAt: '2026-09-13T11:49:59.000Z' }),
      now,
    ).status,
    'offline',
  )
})

test('reports activity at the ten minute boundary as recent', () => {
  assert.equal(
    getDevicePresence(
      device({ lastFrameAt: '2026-09-13T11:50:00.000Z' }),
      now,
    ).status,
    'recent',
  )
})

test('disabled state takes precedence over recent activity', () => {
  assert.equal(
    getDevicePresence(
      device({
        disabledAt: '2026-09-13T11:59:00.000Z',
        lastFrameAt: '2026-09-13T11:59:00.000Z',
        token: null,
      }),
      now,
    ).status,
    'disabled',
  )
})
