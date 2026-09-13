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

const toTaipeiTimestamp = (value) =>
  new Date(Date.parse(value) + 8 * 60 * 60_000)
    .toISOString()
    .replace('.000Z', '+08:00')

const frameKeyFor = (deviceId, value) => {
  const timestamp = new Date(value).toISOString()

  return [
    'frames',
    deviceId,
    timestamp.slice(0, 4),
    timestamp.slice(5, 7),
    timestamp.slice(8, 10),
    timestamp.slice(11, 13),
    timestamp.slice(14, 16),
    `${timestamp.replaceAll('-', '').replaceAll(':', '').replace('.000', '')}.jpg`,
  ].join('/')
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
    timezone: 'Asia/Taipei',
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
      'get_frame_comparison_sheet',
      'get_original_frame',
    ],
  )

  const disabledFrameDownloadsResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'create_original_frame_downloads',
          arguments: { deviceId: device.id, capturedAts: [] },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const disabledFrameDownloads = await readMcpResponse(
    disabledFrameDownloadsResponse,
  )
  assert.equal(
    disabledFrameDownloads.error !== undefined ||
      disabledFrameDownloads.result?.isError === true,
    true,
  )
  assert.match(
    disabledFrameDownloads.error?.message ??
      disabledFrameDownloads.result?.content?.[0]?.text ??
      '',
    /Tool create_original_frame_downloads not found/u,
  )
  assert.equal(disabledFrameDownloads.result?.structuredContent, undefined)

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

  const deviceListResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_devices', arguments: {} },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  assert.equal(deviceListResponse.status, 200)
  const deviceList = await readMcpResponse(deviceListResponse)
  assert.equal(
    deviceList.result.structuredContent.devices[0].timezone,
    'Asia/Taipei',
  )

  const rangeEndAt = new Date(Math.floor(Date.now() / 60_000) * 60_000)
  const rangeBeginAt = new Date(rangeEndAt.getTime() - 30_000)
  const capturedAt = new Date(rangeBeginAt.getTime() + 5_000).toISOString()
  const comparisonCapturedAts = Array.from({ length: 6 }, (_, index) =>
    new Date(rangeBeginAt.getTime() + (index + 1) * 5_000).toISOString(),
  )
  const comparisonCapturedAt = comparisonCapturedAts[1]
  env.BUCKET = {
    async list() {
      return {
        objects: [
          {
            key: 'frame.jpg',
            size: 12_345,
            customMetadata: {
              capturedAt,
              capturedAtLocal: toTaipeiTimestamp(capturedAt),
              timezone: 'Asia/Taipei',
            },
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
      capturedAtLocal: toTaipeiTimestamp(capturedAt),
      byteSize: 12_345,
      offsetMs: 5_000,
      timezone: 'Asia/Taipei',
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
        capturedAtLocal: toTaipeiTimestamp(targetAt.toISOString()),
        deltaMs: 0,
        status: 'captured',
        timezone: 'Asia/Taipei',
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
  let frameBodyCancelCount = 0
  let frameReadFailureAt = null
  let frameSize = jpeg.byteLength
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
        body: new Response(jpeg).body,
        size: jpeg.byteLength,
        httpMetadata: { contentType: 'image/jpeg' },
        async arrayBuffer() {
          return jpeg.buffer
        },
      }
    }

    const frameCapturedAt =
      comparisonCapturedAts.find(
        (value) => key === frameKeyFor(device.id, value),
      ) ?? null

    if (frameCapturedAt) {
      return {
        body: {
          async cancel() {
            frameBodyCancelCount += 1
          },
        },
        size: frameSize,
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: {
          capturedAt: frameCapturedAt,
          capturedAtLocal: toTaipeiTimestamp(frameCapturedAt),
          timezone: 'Asia/Taipei',
        },
        async arrayBuffer() {
          if (frameCapturedAt === frameReadFailureAt) {
            throw new Error('R2 body read failed')
          }

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
  assert.deepEqual(
    contactSheet.result.structuredContent.slots[0],
    sheets[1].slots[0],
  )

  const originalFrameResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'get_original_frame',
          arguments: {
            deviceId: device.id,
            capturedAt,
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  assert.equal(originalFrameResponse.status, 200)
  const originalFrame = await readMcpResponse(originalFrameResponse)
  assert.deepEqual(originalFrame.result.structuredContent, {
    deviceId: device.id,
    deviceName: device.name,
    capturedAt,
    capturedAtLocal: toTaipeiTimestamp(capturedAt),
    byteSize: jpeg.byteLength,
    mimeType: 'image/jpeg',
    original: true,
    timezone: 'Asia/Taipei',
  })

  const imageCalls = []
  let imageInfoCall = 0
  let invalidImageInfoCall = null
  let imageInfoPause = null
  let notifyImageInfoStarted = null
  const createImageTransformer = () => ({
    draw(_image, options) {
      imageCalls.push({ operation: 'draw', options })
      return this
    },
    transform(options) {
      imageCalls.push({ operation: 'transform', options })
      return this
    },
    async output(options) {
      imageCalls.push({ operation: 'output', options })
      return {
        contentType() {
          return options.format === 'image/jpeg' ? 'image/jpeg' : 'image/png'
        },
        image() {
          return new Response(jpeg).body
        },
      }
    },
  })
  Object.assign(env, {
    ASSETS: {
      async fetch() {
        return new Response(jpeg, {
          headers: { 'Content-Type': 'image/png' },
        })
      },
    },
    IMAGES: {
      async info() {
        imageInfoCall += 1
        imageCalls.push({ operation: 'info' })
        notifyImageInfoStarted?.()
        notifyImageInfoStarted = null

        if (imageInfoPause) await imageInfoPause

        if (imageInfoCall === invalidImageInfoCall) {
          throw new Error('Invalid image data')
        }

        return { format: 'image/jpeg', width: 1, height: 1 }
      },
      input() {
        imageCalls.push({ operation: 'input' })
        return createImageTransformer()
      },
    },
  })
  const comparisonToolsResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/list',
        params: {},
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const comparisonTools = await readMcpResponse(comparisonToolsResponse)
  const frameComparisonTool = comparisonTools.result.tools.find(
    ({ name }) => name === 'get_frame_comparison_sheet',
  )
  assert(frameComparisonTool)
  assert.equal(frameComparisonTool.inputSchema.properties.capturedAts.minItems, 2)
  assert.equal(frameComparisonTool.inputSchema.properties.capturedAts.maxItems, 10)
  assert.equal(frameComparisonTool.annotations.readOnlyHint, true)

  const comparisonResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'get_frame_comparison_sheet',
          arguments: {
            deviceId: device.id,
            capturedAts: comparisonCapturedAts,
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  assert.equal(comparisonResponse.status, 200)
  const comparison = await readMcpResponse(comparisonResponse)
  assert.equal(
    comparison.result.isError,
    undefined,
    comparison.result.content?.[0]?.text,
  )
  assert.deepEqual(
    JSON.parse(comparison.result.content[0].text),
    comparison.result.structuredContent,
  )
  assert.deepEqual(
    comparison.result.content.find(({ type }) => type === 'image'),
    {
      type: 'image',
      data: '/9j/2Q==',
      mimeType: 'image/jpeg',
    },
  )
  assert.deepEqual(comparison.result.structuredContent, {
    deviceId: device.id,
    deviceName: device.name,
    generatedAt: comparison.result.structuredContent.generatedAt,
    requestedCount: 6,
    availableCount: 6,
    unavailableCount: 0,
    byteSize: jpeg.byteLength,
    mimeType: 'image/jpeg',
    original: false,
    grid: {
      order: 'row-major',
      rows: 3,
      columns: 2,
      tileWidth: 640,
      tileHeight: 360,
      width: 1_280,
      height: 1_080,
    },
    frames: comparisonCapturedAts.map((value, slot) => ({
      slot,
      row: Math.floor(slot / 2),
      column: slot % 2,
      capturedAt: value,
      capturedAtLocal: toTaipeiTimestamp(value),
      timezone: 'Asia/Taipei',
      sourceByteSize: jpeg.byteLength,
      status: 'available',
    })),
  })
  assert.deepEqual(
    imageCalls
      .filter(({ operation }) => operation === 'draw')
      .map(({ options }) => options),
    [
      { left: 0, top: 0 },
      { left: 640, top: 0 },
      { left: 0, top: 360 },
      { left: 640, top: 360 },
      { left: 0, top: 720 },
      { left: 640, top: 720 },
    ],
  )
  assert.equal(
    imageCalls.some(
      ({ operation, options }) =>
        operation === 'output' && options.format === 'image/png',
    ),
    true,
  )
  assert.equal(
    imageCalls.some(
      ({ operation, options }) =>
        operation === 'output' &&
        options.format === 'image/jpeg' &&
        options.quality === 85,
    ),
    true,
  )

  let releaseImageInfo
  imageInfoPause = new Promise((resolve) => {
    releaseImageInfo = resolve
  })
  const imageInfoStarted = new Promise((resolve) => {
    notifyImageInfoStarted = resolve
  })
  const pendingComparisonResponse = worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'get_frame_comparison_sheet',
          arguments: {
            deviceId: device.id,
            capturedAts: [capturedAt, comparisonCapturedAt],
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  await imageInfoStarted

  const busyComparisonResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'get_frame_comparison_sheet',
          arguments: {
            deviceId: device.id,
            capturedAts: [capturedAt, comparisonCapturedAt],
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const busyComparison = await readMcpResponse(busyComparisonResponse)
  assert.equal(busyComparison.result.isError, true)
  assert.equal(
    JSON.parse(busyComparison.result.content[0].text).error.code,
    'frame_comparison_busy',
  )

  releaseImageInfo()
  imageInfoPause = null
  const completedPendingComparison = await readMcpResponse(
    await pendingComparisonResponse,
  )
  assert.equal(
    completedPendingComparison.result.isError,
    undefined,
    completedPendingComparison.result.content?.[0]?.text,
  )

  invalidImageInfoCall = imageInfoCall + 2
  const partialComparisonResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'get_frame_comparison_sheet',
          arguments: {
            deviceId: device.id,
            capturedAts: [capturedAt, comparisonCapturedAt],
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const partialComparison = await readMcpResponse(partialComparisonResponse)
  assert.equal(
    partialComparison.result.isError,
    undefined,
    partialComparison.result.content?.[0]?.text,
  )
  assert.equal(partialComparison.result.structuredContent.availableCount, 1)
  assert.equal(partialComparison.result.structuredContent.unavailableCount, 1)
  assert.deepEqual(partialComparison.result.structuredContent.frames[1], {
    slot: 1,
    row: 0,
    column: 1,
    capturedAt: comparisonCapturedAt,
    status: 'unavailable',
    error: {
      code: 'frame_access_failed',
      message: 'The frame could not be validated. Retry the request.',
    },
  })
  invalidImageInfoCall = null

  frameSize = 9 * 1024 * 1024
  frameReadFailureAt = comparisonCapturedAts[1]
  const cancelCountBeforeReadFailure = frameBodyCancelCount
  const readFailureComparisonResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'get_frame_comparison_sheet',
          arguments: {
            deviceId: device.id,
            capturedAts: comparisonCapturedAts.slice(0, 3),
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const readFailureComparison = await readMcpResponse(
    readFailureComparisonResponse,
  )
  assert.equal(
    readFailureComparison.result.isError,
    undefined,
    readFailureComparison.result.content?.[0]?.text,
  )
  assert.equal(readFailureComparison.result.structuredContent.availableCount, 2)
  assert.equal(
    readFailureComparison.result.structuredContent.unavailableCount,
    1,
  )
  assert.equal(
    readFailureComparison.result.structuredContent.frames[1].error.code,
    'frame_access_failed',
  )
  assert.equal(frameBodyCancelCount, cancelCountBeforeReadFailure + 1)

  frameReadFailureAt = null
  frameSize = 13 * 1024 * 1024
  const cancelCountBeforeSourceLimit = frameBodyCancelCount
  const sourceLimitComparisonResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'get_frame_comparison_sheet',
          arguments: {
            deviceId: device.id,
            capturedAts: comparisonCapturedAts.slice(0, 2),
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const sourceLimitComparison = await readMcpResponse(
    sourceLimitComparisonResponse,
  )
  assert.equal(sourceLimitComparison.result.isError, true)
  assert.equal(
    JSON.parse(sourceLimitComparison.result.content[0].text).error.code,
    'frame_comparison_source_too_large',
  )
  assert.equal(frameBodyCancelCount, cancelCountBeforeSourceLimit + 1)
  frameSize = jpeg.byteLength

  const duplicateComparisonResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'get_frame_comparison_sheet',
          arguments: {
            deviceId: device.id,
            capturedAts: [capturedAt, toTaipeiTimestamp(capturedAt)],
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const duplicateComparison = await readMcpResponse(
    duplicateComparisonResponse,
  )
  assert.equal(duplicateComparison.result.isError, true)
  assert.equal(
    JSON.parse(duplicateComparison.result.content[0].text).error.code,
    'captured_at_duplicate',
  )

  env.MCP_ENABLE_FRAME_DOWNLOAD_URLS = 'TRUE'
  const nonExactFlagToolsResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/list',
        params: {},
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const nonExactFlagTools = await readMcpResponse(nonExactFlagToolsResponse)
  assert.equal(
    nonExactFlagTools.result.tools.some(
      ({ name }) => name === 'create_original_frame_downloads',
    ),
    false,
  )

  Object.assign(env, {
    MCP_ENABLE_FRAME_DOWNLOAD_URLS: 'true',
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_BUCKET_NAME: 'sight-cache',
    R2_ACCESS_KEY_ID: 'test-r2-access-key',
    R2_SECRET_ACCESS_KEY: 'test-r2-secret-access-key',
  })
  const missingCapturedAt = new Date(
    Date.parse(capturedAt) + 5_000,
  ).toISOString()
  const failedCapturedAt = new Date(
    Date.parse(capturedAt) + 10_000,
  ).toISOString()
  env.BUCKET.head = async (key) => {
    if (key === frameKeyFor(device.id, failedCapturedAt)) {
      throw new Error('Temporary R2 failure')
    }

    if (key !== frameKeyFor(device.id, capturedAt)) return null

    return {
      key,
      size: jpeg.byteLength,
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: {
        capturedAt,
        capturedAtLocal: toTaipeiTimestamp(capturedAt),
        timezone: 'Asia/Taipei',
      },
    }
  }

  const enabledToolsResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/list',
        params: {},
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const enabledTools = await readMcpResponse(enabledToolsResponse)
  const frameDownloadsTool = enabledTools.result.tools.find(
    ({ name }) => name === 'create_original_frame_downloads',
  )
  assert(frameDownloadsTool)
  assert.equal(
    frameDownloadsTool.inputSchema.properties.capturedAts.maxItems,
    20,
  )

  const frameDownloadsResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'create_original_frame_downloads',
          arguments: {
            deviceId: device.id,
            capturedAts: [capturedAt, missingCapturedAt, failedCapturedAt],
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  assert.equal(
    frameDownloadsResponse.status,
    200,
    await frameDownloadsResponse.clone().text(),
  )
  const frameDownloads = await readMcpResponse(frameDownloadsResponse)
  assert.equal(frameDownloads.result.isError, undefined)
  assert.equal(
    frameDownloads.result.content.every(({ type }) => type === 'text'),
    true,
  )
  assert.deepEqual(
    JSON.parse(frameDownloads.result.content[0].text),
    frameDownloads.result.structuredContent,
  )
  assert.equal(frameDownloads.result.structuredContent.requestedCount, 3)
  assert.equal(frameDownloads.result.structuredContent.availableCount, 1)
  assert.equal(frameDownloads.result.structuredContent.unavailableCount, 2)
  assert.equal(
    Date.parse(frameDownloads.result.structuredContent.expiresAt) - Date.now() >
      29 * 60_000,
    true,
  )

  const [availableDownload, unavailableDownload, failedDownload] =
    frameDownloads.result.structuredContent.frames
  assert.equal(availableDownload.status, 'available')
  assert.equal(availableDownload.capturedAt, capturedAt)
  assert.equal(availableDownload.original, true)
  const downloadUrl = new URL(availableDownload.downloadUrl)
  assert.equal(
    downloadUrl.hostname,
    '0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
  )
  assert.equal(
    downloadUrl.pathname,
    `/${frameKeyFor(device.id, capturedAt)}`.replace(
      '/frames/',
      '/sight-cache/frames/',
    ),
  )
  assert.equal(downloadUrl.searchParams.get('X-Amz-Expires'), '1800')
  assert.match(
    downloadUrl.searchParams.get('X-Amz-Credential') ?? '',
    /^test-r2-access-key\/\d{8}\/auto\/s3\/aws4_request$/u,
  )
  assert.match(
    downloadUrl.searchParams.get('X-Amz-Signature') ?? '',
    /^[0-9a-f]{64}$/u,
  )
  assert.deepEqual(unavailableDownload, {
    capturedAt: missingCapturedAt,
    status: 'unavailable',
    error: {
      code: 'frame_not_found',
      message: 'No original frame exists at that exact timestamp.',
    },
  })
  assert.deepEqual(failedDownload, {
    capturedAt: failedCapturedAt,
    status: 'unavailable',
    error: {
      code: 'frame_access_failed',
      message: 'The frame could not be accessed. Retry the request.',
    },
  })

  const duplicateDownloadsResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'create_original_frame_downloads',
          arguments: {
            deviceId: device.id,
            capturedAts: [capturedAt, toTaipeiTimestamp(capturedAt)],
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const duplicateDownloads = await readMcpResponse(
    duplicateDownloadsResponse,
  )
  assert.equal(duplicateDownloads.result.isError, true)
  assert.equal(
    JSON.parse(duplicateDownloads.result.content[0].text).error.code,
    'captured_at_duplicate',
  )

  const fractionalTimestampResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'create_original_frame_downloads',
          arguments: {
            deviceId: device.id,
            capturedAts: [capturedAt.replace('.000Z', '.0001Z')],
          },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const fractionalTimestamp = await readMcpResponse(
    fractionalTimestampResponse,
  )
  assert.equal(fractionalTimestamp.result.isError, true)
  assert.equal(
    JSON.parse(fractionalTimestamp.result.content[0].text).error.code,
    'captured_at_invalid',
  )

  delete env.R2_SECRET_ACCESS_KEY
  const incompleteConfigResponse = await worker.fetch(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'create_original_frame_downloads',
          arguments: { deviceId: device.id, capturedAts: [capturedAt] },
        },
      },
      assertion,
    ),
    env,
    executionContext,
  )
  const incompleteConfig = await readMcpResponse(incompleteConfigResponse)
  assert.equal(incompleteConfig.result.isError, true)
  assert.equal(
    JSON.parse(incompleteConfig.result.content[0].text).error.code,
    'frame_downloads_not_configured',
  )
})
