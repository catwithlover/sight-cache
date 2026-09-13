import assert from 'node:assert/strict'
import test from 'node:test'
import { contactSheetLayouts } from '../src/contact-sheet-layout.ts'
import {
  buildImageKey,
  isAlignedSamplingBeginAt,
  listFrames,
  listFramesInRange,
  sampleFrames,
  samplingLayouts,
} from '../src/frame-sampling.ts'

test('contact sheets use six hourly groups and two minute groups', () => {
  assert.deepEqual(contactSheetLayouts.hour, {
    columns: 2,
    rows: 5,
    sheetCount: 6,
    slotsPerSheet: 10,
  })
  assert.deepEqual(contactSheetLayouts.minute, {
    columns: 2,
    rows: 3,
    sheetCount: 2,
    slotsPerSheet: 6,
  })
  assert.equal(
    contactSheetLayouts.hour.sheetCount *
      contactSheetLayouts.hour.slotsPerSheet,
    samplingLayouts.hour.rows * samplingLayouts.hour.columns,
  )
  assert.equal(
    contactSheetLayouts.minute.sheetCount *
      contactSheetLayouts.minute.slotsPerSheet,
    samplingLayouts.minute.rows * samplingLayouts.minute.columns,
  )
})

test('sampling preserves chronological row-major slots and missing frames', () => {
  const beginAt = new Date('2026-09-13T01:02:00.000Z')
  const endAt = new Date('2026-09-13T01:03:00.000Z')
  const frames = [0, 5, 15].map((seconds) => {
    const capturedAt = new Date(beginAt.getTime() + seconds * 1_000)

    return {
      key: `frame-${seconds}`,
      capturedAt: capturedAt.toISOString(),
      capturedAtMs: capturedAt.getTime(),
      size: 1_024,
    }
  })
  const samples = sampleFrames(frames, {
    beginAt,
    endAt,
    rows: samplingLayouts.minute.rows,
    columns: samplingLayouts.minute.columns,
    toleranceMs: samplingLayouts.minute.toleranceMs,
  })

  assert.equal(samples.length, 12)
  assert.equal(samples[0].frame?.key, 'frame-0')
  assert.equal(samples[1].frame?.key, 'frame-5')
  assert.equal(samples[2].frame, null)
  assert.equal(samples[3].frame?.key, 'frame-15')
  assert.deepEqual(
    samples.slice(0, 4).map(({ slot, row, column }) => ({
      slot,
      row,
      column,
    })),
    [
      { slot: 0, row: 0, column: 0 },
      { slot: 1, row: 0, column: 1 },
      { slot: 2, row: 0, column: 2 },
      { slot: 3, row: 0, column: 3 },
    ],
  )
})

test('frame keys normalize offset timestamps to the ingest UTC layout', () => {
  const key = buildImageKey(
    '01234567-89ab-4def-8123-456789abcdef',
    new Date('2026-09-13T09:02:03+08:00'),
  )

  assert.equal(
    key,
    'frames/01234567-89ab-4def-8123-456789abcdef/2026/09/13/01/02/20260913T010203Z.jpg',
  )
})

test('hour and minute alignment are evaluated in UTC', () => {
  assert.equal(
    isAlignedSamplingBeginAt(
      new Date('2026-09-13T09:00:00+08:00'),
      'hour',
    ),
    true,
  )
  assert.equal(
    isAlignedSamplingBeginAt(
      new Date('2026-09-13T09:01:00+08:00'),
      'hour',
    ),
    false,
  )
  assert.equal(
    isAlignedSamplingBeginAt(
      new Date('2026-09-13T09:01:00+08:00'),
      'minute',
    ),
    true,
  )
})

test('range listing reads only minute prefixes and filters both boundaries', async () => {
  const seenPrefixes = []
  const objects = [
    ['2026-09-13T01:02:25.000Z', 100],
    ['2026-09-13T01:02:30.000Z', 200],
    ['2026-09-13T01:02:55.000Z', 300],
    ['2026-09-13T01:03:05.000Z', 400],
    ['2026-09-13T01:03:10.000Z', 500],
  ].map(([capturedAt, size]) => ({
    key: `frames/device/${capturedAt}`,
    size,
    customMetadata: { capturedAt },
  }))
  const bucket = {
    async list({ prefix }) {
      seenPrefixes.push(prefix)
      const minute = prefix.slice(-3, -1)

      return {
        objects: objects.filter((object) =>
          object.customMetadata.capturedAt.slice(14, 16).includes(minute),
        ),
        truncated: false,
      }
    },
  }
  const frames = await listFramesInRange(
    bucket,
    '01234567-89ab-4def-8123-456789abcdef',
    new Date('2026-09-13T01:02:30.000Z'),
    new Date('2026-09-13T01:03:10.000Z'),
  )

  assert.equal(seenPrefixes.length, 2)
  assert.deepEqual(
    frames.map(({ capturedAt, size }) => ({ capturedAt, size })),
    [
      { capturedAt: '2026-09-13T01:02:30.000Z', size: 200 },
      { capturedAt: '2026-09-13T01:02:55.000Z', size: 300 },
      { capturedAt: '2026-09-13T01:03:05.000Z', size: 400 },
    ],
  )
})

test('frame listing follows R2 cursors and sorts capture metadata', async () => {
  const cursors = []
  const bucket = {
    async list({ cursor }) {
      cursors.push(cursor)

      if (!cursor) {
        return {
          objects: [
            {
              key: 'second.jpg',
              size: 200,
              customMetadata: {
                capturedAt: '2026-09-13T01:02:10.000Z',
              },
            },
          ],
          truncated: true,
          cursor: 'next-page',
        }
      }

      return {
        objects: [
          {
            key: 'first.jpg',
            size: 100,
            customMetadata: {
              capturedAt: '2026-09-13T01:02:05.000Z',
            },
          },
        ],
        truncated: false,
      }
    },
  }
  const frames = await listFrames(bucket, 'frames/device/2026/09/13/01/02/')

  assert.deepEqual(cursors, [undefined, 'next-page'])
  assert.deepEqual(
    frames.map(({ key }) => key),
    ['first.jpg', 'second.jpg'],
  )
})
