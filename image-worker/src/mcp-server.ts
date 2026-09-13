import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { contactSheetLayouts } from './contact-sheet-layout'
import { type Bindings } from './contact-sheets'
import {
  arrayBufferToBase64,
  getContactSheetImage,
  getOriginalFrameImage,
  ImageAccessError,
  listActiveDevices,
  listFrameMetadata,
} from './image-access'

const deviceIdSchema = z.uuid().describe('Active camera device ID')
const timestampSchema = z
  .iso
  .datetime({ offset: true })
  .describe('ISO 8601 timestamp with a timezone offset')

const deviceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  lastUploadAt: z.iso.datetime().nullable(),
})

const contactSheetSlotSchema = z.strictObject({
  slot: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  targetAt: z.iso.datetime(),
  slotEndAt: z.iso.datetime(),
  capturedAt: z.iso.datetime().nullable(),
  deltaMs: z.number().nonnegative().nullable(),
  status: z.enum(['captured', 'missing']),
})

const contactSheetOutputSchema = z.strictObject({
  deviceId: z.uuid(),
  deviceName: z.string(),
  unit: z.enum(['minute', 'hour']),
  beginAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  generatedAt: z.iso.datetime(),
  sheetNumber: z.number().int().positive(),
  sheetCount: z.number().int().positive(),
  availableSheetNumbers: z.array(z.number().int().positive()),
  selectedCount: z.number().int().nonnegative(),
  totalSelectedCount: z.number().int().nonnegative(),
  grid: z.strictObject({
    order: z.literal('row-major'),
    rows: z.number().int().positive(),
    columns: z.number().int().positive(),
    tileWidth: z.number().int().positive(),
    tileHeight: z.number().int().positive(),
  }),
  slots: z.array(contactSheetSlotSchema),
})

const originalFrameOutputSchema = z.strictObject({
  deviceId: z.uuid(),
  deviceName: z.string(),
  capturedAt: z.iso.datetime(),
  byteSize: z.number().int().positive(),
  mimeType: z.literal('image/jpeg'),
  original: z.literal(true),
})

const frameListOutputSchema = z.strictObject({
  deviceId: z.uuid(),
  deviceName: z.string(),
  beginAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  matchingCount: z.number().int().nonnegative(),
  returnedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  nextBeginAt: z.iso.datetime().nullable(),
  frames: z.array(
    z.strictObject({
      capturedAt: z.iso.datetime(),
      byteSize: z.number().int().positive(),
      offsetMs: z.number().int().nonnegative(),
    }),
  ),
})

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const materializingAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const toolError = (error: unknown) => {
  const code =
    error instanceof ImageAccessError ? error.code : 'image_access_failed'
  const message =
    error instanceof ImageAccessError
      ? error.message
      : 'The image request could not be completed.'

  if (!(error instanceof ImageAccessError)) {
    console.error('MCP image tool failed', error)
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: { code, message } }),
      },
    ],
    isError: true,
  }
}

export function createMcpServer(bindings: Bindings) {
  const server = new McpServer(
    {
      name: 'sight-cache',
      version: '0.1.0',
    },
    {
      instructions:
        'Use list_devices first. For an hourly review, inspect all six hourly sheets before drawing conclusions about the scene. Use the two minute sheets to inspect suspicious minutes, list_frames to enumerate the exact nearby captures, then get_original_frame for selected evidence. A missing slot means missing camera data, not evidence that the scene was empty. Times are normalized to UTC.',
    },
  )

  server.registerTool(
    'list_devices',
    {
      title: 'List camera devices',
      description:
        'List active camera devices. Call this first and use lastUploadAt to distinguish a quiet scene from an offline or stale camera.',
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({ devices: z.array(deviceSchema) }),
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        const structuredContent = {
          devices: await listActiveDevices(bindings.DB),
        }

        return {
          content: [
            { type: 'text', text: JSON.stringify(structuredContent) },
          ],
          structuredContent,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    'get_contact_sheet',
    {
      title: 'Get a camera contact sheet',
      description:
        'Return one JPEG group and exact slot timestamps for a completed camera window. An hour has six chronological sheets with ten one-minute samples each. A minute has two chronological sheets with six five-second samples each and is generated on demand. Call every sheetNumber in the window; image order is left-to-right, top-to-bottom. Use capturedAt from a slot to request its untouched original frame.',
      inputSchema: z.strictObject({
        deviceId: deviceIdSchema,
        unit: z.enum(['minute', 'hour']),
        beginAt: timestampSchema.describe(
          'Start of the UTC-aligned minute or hour to inspect',
        ),
        sheetNumber: z
          .number()
          .int()
          .min(1)
          .max(6)
          .describe('One-based image group number'),
      }),
      outputSchema: contactSheetOutputSchema,
      annotations: materializingAnnotations,
    },
    async ({ deviceId, unit, beginAt, sheetNumber }) => {
      try {
        const expectedSheetCount = contactSheetLayouts[unit].sheetCount

        if (sheetNumber > expectedSheetCount) {
          throw new ImageAccessError(
            'sheet_number_invalid',
            `sheetNumber must be between 1 and ${expectedSheetCount} for ${unit}.`,
          )
        }

        const result = await getContactSheetImage(
          bindings,
          deviceId.toLowerCase(),
          unit,
          beginAt,
          sheetNumber,
        )
        const structuredContent = {
          deviceId: result.device.id,
          deviceName: result.device.name,
          unit: result.manifest.unit,
          beginAt: result.manifest.beginAt,
          endAt: result.manifest.endAt,
          generatedAt: result.manifest.generatedAt,
          sheetNumber: result.sheet.number,
          sheetCount: result.manifest.layout.sheetCount,
          availableSheetNumbers: result.manifest.sheets.map(
            (sheet) => sheet.number,
          ),
          selectedCount: result.sheet.selectedCount,
          totalSelectedCount: result.manifest.selectedCount,
          grid: {
            order: result.manifest.layout.order,
            rows: result.sheet.rows,
            columns: result.sheet.columns,
            tileWidth: result.manifest.layout.tileWidth,
            tileHeight: result.manifest.layout.tileHeight,
          },
          slots: result.sheet.slots,
        }

        return {
          content: [
            { type: 'text', text: JSON.stringify(structuredContent) },
            {
              type: 'image',
              data: arrayBufferToBase64(result.bytes),
              mimeType: result.mimeType,
            },
          ],
          structuredContent,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    'list_frames',
    {
      title: 'List camera frames in a time range',
      description:
        'List exact frame timestamps in a bounded suspicious interval without downloading images. Use this after contact-sheet triage to find neighboring captures, then call get_original_frame only for selected capturedAt values. The range is inclusive of beginAt, exclusive of endAt, and may span at most five minutes. If truncated is true, continue with nextBeginAt and the same endAt.',
      inputSchema: z.strictObject({
        deviceId: deviceIdSchema,
        beginAt: timestampSchema.describe('Inclusive start of the frame range'),
        endAt: timestampSchema.describe('Exclusive end of the frame range'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(300)
          .default(120)
          .describe('Maximum frame timestamps to return'),
      }),
      outputSchema: frameListOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ deviceId, beginAt, endAt, limit }) => {
      try {
        const result = await listFrameMetadata(
          bindings,
          deviceId.toLowerCase(),
          beginAt,
          endAt,
          limit,
        )
        const structuredContent = {
          deviceId: result.device.id,
          deviceName: result.device.name,
          beginAt: result.beginAt,
          endAt: result.endAt,
          matchingCount: result.matchingCount,
          returnedCount: result.frames.length,
          truncated: result.truncated,
          nextBeginAt: result.nextBeginAt,
          frames: result.frames,
        }

        return {
          content: [
            { type: 'text', text: JSON.stringify(structuredContent) },
          ],
          structuredContent,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    'get_original_frame',
    {
      title: 'Get an original camera frame',
      description:
        'Return the complete JPEG bytes uploaded by the camera without resizing, cropping, or recompression. Use an exact whole-second capturedAt value returned by get_contact_sheet or list_frames, and request only a small number of evidence frames after contact-sheet triage.',
      inputSchema: z.strictObject({
        deviceId: deviceIdSchema,
        capturedAt: timestampSchema.describe(
          'Exact whole-second capturedAt value from a contact-sheet slot',
        ),
      }),
      outputSchema: originalFrameOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ deviceId, capturedAt }) => {
      try {
        const result = await getOriginalFrameImage(
          bindings,
          deviceId.toLowerCase(),
          capturedAt,
        )
        const structuredContent = {
          deviceId: result.device.id,
          deviceName: result.device.name,
          capturedAt: result.capturedAt,
          byteSize: result.size,
          mimeType: 'image/jpeg' as const,
          original: true as const,
        }

        return {
          content: [
            { type: 'text', text: JSON.stringify(structuredContent) },
            {
              type: 'image',
              data: arrayBufferToBase64(result.bytes),
              mimeType: result.mimeType,
            },
          ],
          structuredContent,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  return server
}
