import test from 'node:test'
import assert from 'node:assert/strict'
import { groupByDate, monthGrid, monthStart, shiftMonth } from '../src/lib/calendar.ts'

test('monthGrid covers whole Monday-first weeks', () => {
  const grid = monthGrid('2026-11-07') // 1 Nov 2026 is a Sunday
  assert.equal(grid[0], '2026-10-26')
  assert.equal(grid.at(-1), '2026-12-06') // 30 Nov is a Monday, so that week is shown in full
  assert.equal(grid.length, 42)
})

test('monthGrid includes the last day of the month', () => {
  for (const m of ['2026-02-10', '2026-03-31', '2027-02-01', '2026-11-30']) {
    const grid = monthGrid(m)
    const next = shiftMonth(m, 1)
    assert.ok(grid.includes(monthStart(m)))
    assert.ok(grid.includes(new Date(Date.parse(`${next}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)))
    assert.equal(new Date(`${grid[0]}T00:00:00Z`).getUTCDay(), 1)
  }
})

test('shiftMonth crosses year boundaries', () => {
  assert.equal(shiftMonth('2026-12-15', 1), '2027-01-01')
  assert.equal(shiftMonth('2026-01-31', -1), '2025-12-01')
})

test('groupByDate keeps order', () => {
  const m = groupByDate([{ d: 'a', n: 1 }, { d: 'b', n: 2 }, { d: 'a', n: 3 }], (x) => x.d)
  assert.deepEqual(m.get('a')!.map((x) => x.n), [1, 3])
})
