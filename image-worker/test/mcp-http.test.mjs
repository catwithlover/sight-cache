import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose'
import worker from '../.test-build/index.js'

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
}

const readMcpResponse = async (response) => {
  const text = await response.text()

  if (!response.headers.get('Content-Type')?.includes('text/event-stream')) {
    return JSON.parse(text)
  }

  const data = text
    .split('\n')
    .find((line) => line.startsWith('data:'))
    ?.slice(5)
    .trim()

  if (!data) throw new Error(`MCP SSE response has no data: ${text}`)

  return JSON.parse(data)
}

const mcpRequest = (
  body,
  assertion,
  url = 'http://localhost:8787/mcp',
) => {
  const requestUrl = new URL(url)
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    Host: requestUrl.host,
    'MCP-Protocol-Version': '2025-06-18',
    Origin: 'https://chatgpt.com',
  }

  if (assertion) {
    headers.Authorization = 'Bearer oauth:opaque-access-token'
    headers['Cf-Access-Jwt-Assertion'] = assertion
  }

  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

test('local MCP bypass is restricted to loopback requests', async () => {
  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'sight-cache-test', version: '1.0.0' },
    },
  }
  const env = {
    LOCAL_MCP_BYPASS: 'true',
    LOCAL_MCP_EMAIL: 'developer@example.test',
  }
  const localResponse = await worker.fetch(
    mcpRequest(initialize),
    env,
    executionContext,
  )
  assert.equal(localResponse.status, 200, await localResponse.clone().text())

  const nonLoopbackResponse = await worker.fetch(
    mcpRequest(initialize, undefined, 'https://camera.example.com/mcp'),
    env,
    executionContext,
  )
  assert.equal(nonLoopbackResponse.status, 503)
})

test('Cloudflare Access protects MCP tool discovery and calls', async (t) => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  Object.assign(jwk, { alg: 'RS256', kid: 'test-key', use: 'sig' })

  const jwksServer = createServer((request, response) => {
    if (request.url !== '/cdn-cgi/access/certs') {
      response.writeHead(404).end()
      return
    }

    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => jwksServer.close(resolve)))

  const address = jwksServer.address()
  assert(address && typeof address === 'object')

  const issuer = `http://127.0.0.1:${address.port}`
  const resource = 'http://localhost:8787'
  const audience = 'test-access-application-aud'
  const device = {
    id: '01234567-89ab-4def-8123-456789abcdef',
    name: 'Camera 1',
    last_frame_at: new Date().toISOString(),
  }
  const statement = {
    bind() {
      return this
    },
    async first() {
      return device
    },
    async all() {
      return { results: [device] }
    },
  }
  const env = {
    DB: {
      prepare() {
        return statement
      },
    },
    ACCESS_AUD: audience,
    ACCESS_TEAM_DOMAIN: issuer,
  }

  const metadataResponse = await worker.fetch(
    new Request(`${resource}/.well-known/oauth-protected-resource`),
    env,
    executionContext,
  )
  assert.equal(metadataResponse.status, 404)

  const removedDeviceRouteResponse = await worker.fetch(
    new Request(`${resource}/${device.id}`),
    env,
    executionContext,
  )
  assert.equal(removedDeviceRouteResponse.status, 404)

  const mcpPreflightResponse = await worker.fetch(
    new Request(`${resource}/mcp`, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Headers':
          'authorization, content-type, mcp-protocol-version',
        'Access-Control-Request-Method': 'POST',
        Host: 'localhost:8787',
        Origin: 'https://chatgpt.com',
      },
    }),
    env,
    executionContext,
  )
  assert.equal(mcpPreflightResponse.ok, true)
  assert.equal(
    mcpPreflightResponse.headers.get('Access-Control-Allow-Origin'),
    '*',
  )
  assert.match(
    mcpPreflightResponse.headers.get('Access-Control-Allow-Headers') ?? '',
    /MCP-Protocol-Version/iu,
  )

  const unauthorizedResponse = await worker.fetch(
    new Request(`${resource}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    env,
    executionContext,
  )
  assert.equal(unauthorizedResponse.status, 401)
  assert.deepEqual(await unauthorizedResponse.json(), {
    error: {
      code: 'access_required',
      message: 'Cloudflare Access authentication is required.',
    },
  })

  const assertionWithoutExpiration = await new SignJWT({
    email: 'viewer@example.com',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('access-user')
    .setIssuedAt()
    .sign(privateKey)
  const noExpirationResponse = await worker.fetch(
    mcpRequest({}, assertionWithoutExpiration),
    env,
    executionContext,
  )
  assert.equal(noExpirationResponse.status, 403)

  const wrongAudienceAssertion = await new SignJWT({
    email: 'viewer@example.com',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience('another-access-application')
    .setSubject('access-user')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
  const wrongAudienceResponse = await worker.fetch(
    mcpRequest({}, wrongAudienceAssertion),
    env,
    executionContext,
  )
  assert.equal(wrongAudienceResponse.status, 403)

  const assertion = await new SignJWT({
    email: 'viewer@example.com',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('access-user')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

  const initializeResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'sight-cache-test', version: '1.0.0' },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  assert.equal(
    initializeResponse.status,
    200,
    await initializeResponse.clone().text(),
  )
  const initialize = await readMcpResponse(initializeResponse)
  assert.equal(initialize.result.serverInfo.name, 'sight-cache')

  const toolsResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
      assertion,
    ),
    env,
    executionContext,
  )
  assert.equal(toolsResponse.status, 200)
  const tools = await readMcpResponse(toolsResponse)

  assert.deepEqual(
    tools.result.tools.map(({ name }) => name),
    [
      'list_devices',
      'get_contact_sheet',
      'list_frames',
      'get_original_frame',
    ],
  )
  const contactSheetTool = tools.result.tools.find(
    (tool) => tool.name === 'get_contact_sheet',
  )
  assert.deepEqual(contactSheetTool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  })
  assert.equal(
    tools.result.tools
      .filter((tool) => tool.name !== 'get_contact_sheet')
      .every((tool) => tool.annotations.readOnlyHint === true),
    true,
  )

  const rangeEndAt = new Date(Math.floor(Date.now() / 60_000) * 60_000)
  const rangeBeginAt = new Date(rangeEndAt.getTime() - 30_000)
  const capturedAt = new Date(rangeBeginAt.getTime() + 5_000).toISOString()
  env.BUCKET = {
    async list() {
      return {
        objects: [
          {
            key: 'frame.jpg',
            size: 12_345,
            customMetadata: { capturedAt },
          },
        ],
        truncated: false,
      }
    },
  }

  const frameListResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'list_frames',
          arguments: {
            deviceId: device.id,
            beginAt: rangeBeginAt.toISOString(),
            endAt: rangeEndAt.toISOString(),
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  assert.equal(frameListResponse.status, 200)
  const frameList = await readMcpResponse(frameListResponse)
  assert.equal(frameList.result.isError, undefined)
  assert.deepEqual(frameList.result.structuredContent.frames, [
    {
      capturedAt,
      byteSize: 12_345,
      offsetMs: 5_000,
    },
  ])

  const hourBeginAt = new Date(
    Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000,
  )
  const sheets = Array.from({ length: 6 }, (_, sheetIndex) => ({
    index: sheetIndex,
    number: sheetIndex + 1,
    key: `test/sheet-${sheetIndex + 1}.jpg`,
    rows: 5,
    columns: 2,
    width: 1_280,
    height: 1_800,
    selectedCount: 10,
    slots: Array.from({ length: 10 }, (_, localSlot) => {
      const slot = sheetIndex * 10 + localSlot
      const targetAt = new Date(hourBeginAt.getTime() + slot * 60_000)

      return {
        slot,
        row: Math.floor(localSlot / 2),
        column: localSlot % 2,
        targetAt: targetAt.toISOString(),
        slotEndAt: new Date(targetAt.getTime() + 60_000).toISOString(),
        capturedAt: targetAt.toISOString(),
        deltaMs: 0,
        status: 'captured',
      }
    }),
  }))
  const manifest = {
    schemaVersion: 1,
    type: 'hourly-contact-sheets',
    deviceId: device.id,
    unit: 'hour',
    beginAt: hourBeginAt.toISOString(),
    endAt: new Date(hourBeginAt.getTime() + 3_600_000).toISOString(),
    generatedAt: new Date().toISOString(),
    candidateCount: 60,
    selectedCount: 60,
    sampling: { slotCount: 60, toleranceMs: 10_000 },
    layout: {
      order: 'row-major',
      origin: 'top-left',
      tileWidth: 640,
      tileHeight: 360,
      rows: 5,
      columns: 2,
      width: 1_280,
      height: 1_800,
      sheetCount: 6,
    },
    sheets,
  }
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
  env.BUCKET.get = async (key) => {
    if (key.endsWith('/manifest.json')) {
      return {
        async text() {
          return JSON.stringify(manifest)
        },
      }
    }

    if (key === sheets[1].key) {
      return {
        size: jpeg.byteLength,
        httpMetadata: { contentType: 'image/jpeg' },
        async arrayBuffer() {
          return jpeg.buffer
        },
      }
    }

    return null
  }

  const contactSheetResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_contact_sheet',
          arguments: {
            deviceId: device.id,
            unit: 'hour',
            beginAt: hourBeginAt.toISOString(),
            sheetNumber: 2,
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  assert.equal(contactSheetResponse.status, 200)
  const contactSheet = await readMcpResponse(contactSheetResponse)
  assert.equal(contactSheet.result.isError, undefined)
  assert.equal(contactSheet.result.structuredContent.sheetNumber, 2)
  assert.deepEqual(
    contactSheet.result.structuredContent.availableSheetNumbers,
    [1, 2, 3, 4, 5, 6],
  )
  assert.deepEqual(
    contactSheet.result.content.find(({ type }) => type === 'image'),
    {
      type: 'image',
      data: '/9j/2Q==',
      mimeType: 'image/jpeg',
    },
  )
})
