import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../.test-build/index.js'

const deviceId = '01234567-89ab-4def-8123-456789abcdef'
const imageBytes = new Uint8Array([1, 2, 3])

const filenameAt = (offsetMs) =>
  new Date(Math.floor(Date.now() / 1000) * 1000 + offsetMs)
    .toISOString()
    .replace('.000Z', '+0000.jpg')

const ingestRequest = (filename) =>
  new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-collector-token',
      'Content-Length': String(imageBytes.byteLength),
      'Content-Type': 'image/jpeg',
      'X-Filename': filename,
    },
    body: imageBytes,
  })

const createEnvironment = (putResult) => {
  const putCalls = []
  const env = {
    BUCKET: {
      async put(key, _body, options) {
        putCalls.push({ key, options })
        return putResult
      },
    },
    DB: {
      prepare(query) {
        const statement = {
          bind() {
            return statement
          },
          async first() {
            assert.match(query, /FROM device_tokens/u)
            return {
              id: deviceId,
              name: 'Camera 1',
              last_frame_at: null,
              token_id: 'test-token-id',
              token_last_used_at: new Date().toISOString(),
            }
          },
          async run() {
            return { success: true }
          },
        }

        return statement
      },
    },
  }

  return { env, putCalls }
}

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
}

test('accepts capture timestamps within the clock skew allowance', async () => {
  const { env, putCalls } = createEnvironment({ uploaded: new Date() })
  const response = await worker.fetch(
    ingestRequest(filenameAt(60_000)),
    env,
    executionContext,
  )

  assert.equal(response.status, 200)
  assert.equal(putCalls.length, 1)
})

test('rejects capture timestamps beyond the clock skew allowance', async () => {
  const { env, putCalls } = createEnvironment(null)
  const response = await worker.fetch(
    ingestRequest(filenameAt(6 * 60_000)),
    env,
    executionContext,
  )

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: {
      code: 'captured_at_future',
      message:
        'x-filename capture time must not be more than 5 minutes in the future.',
    },
  })
  assert.equal(putCalls.length, 0)
})

test('uses an atomic R2 precondition and does not overwrite a frame', async () => {
  const { env, putCalls } = createEnvironment(null)
  const response = await worker.fetch(
    ingestRequest(filenameAt(-60_000)),
    env,
    executionContext,
  )

  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    error: {
      code: 'frame_already_exists',
      message: 'A frame already exists for this device and capture time.',
    },
  })
  assert.equal(putCalls.length, 1)
  assert.deepEqual(putCalls[0].options.onlyIf, {
    etagDoesNotMatch: '*',
  })
})
