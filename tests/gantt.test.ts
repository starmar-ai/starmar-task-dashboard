import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from '../src/lib/dates.ts'
import { buildScale, clampDelta, dependencyClash, defaultZoom, shiftDates } from '../src/lib/gantt.ts'

test('addDays crosses month and year ends', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
})

test('buildScale covers all dates and today', () => {
  const s = buildScale(['2026-11-10', '2026-11-20'], '2026-11-07')
  assert.equal(s.min, '2026-10-24')
  assert.equal(addDays(s.min, s.days - 1), '2027-01-04')
})

test('defaultZoom gets coarser with longer ranges', () => {
  assert.equal(defaultZoom(40), 'day')
  assert.equal(defaultZoom(120), 'week')
  assert.equal(defaultZoom(400), 'month')
})

test('move shifts both dates; deadline-only tasks shift the deadline', () => {
  assert.deepEqual(shiftDates('2026-11-10', '2026-11-12', 'move', 3), { start: '2026-11-13', end: '2026-11-15' })
  assert.deepEqual(shiftDates(null, '2026-11-12', 'move', -2), { start: null, end: '2026-11-10' })
})

test('resizing never lets the start pass the end or the end pass the start', () => {
  assert.equal(clampDelta('start', '2026-11-10', '2026-11-12', 9), 2)
  assert.equal(clampDelta('end', '2026-11-10', '2026-11-12', -9), -2)
  assert.deepEqual(shiftDates('2026-11-10', '2026-11-12', 'start', 9), { start: '2026-11-12', end: '2026-11-12' })
  assert.deepEqual(shiftDates('2026-11-10', '2026-11-12', 'end', -9), { start: '2026-11-10', end: '2026-11-10' })
})

test('a dependent that starts on or before the end of what it waits for is a clash', () => {
  assert.equal(dependencyClash('2026-11-12', '2026-11-12'), true)
  assert.equal(dependencyClash('2026-11-13', '2026-11-12'), false)
})
