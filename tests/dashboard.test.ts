import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addMonths,
  focusToday,
  inBucket,
  isDueInRange,
  isOverdue,
  loadByProject,
  needsAttention,
  periodRange,
} from '../src/lib/dashboard.ts'
import type { Task } from '../src/lib/types.ts'

const today = '2026-11-06'
let n = 0
function task(p: Partial<Task>): Task {
  n++
  return {
    id: `t${n}`,
    project_id: 'p1',
    title: `Task ${n}`,
    description: null,
    status: 'todo',
    priority: 'medium',
    start_date: null,
    deadline: today,
    assignee_id: 'me',
    reviewer_id: null,
    created_by: 'me',
    created_at: `2026-11-01T00:00:0${n % 10}Z`,
    updated_at: '2026-11-01T00:00:00Z',
    task_labels: [],
    ...p,
  }
}

test('period ranges are inclusive and start today', () => {
  assert.deepEqual(periodRange('today', today), { from: today, to: today })
  assert.deepEqual(periodRange('7d', today), { from: today, to: '2026-11-12' })
  assert.deepEqual(periodRange('1m', today), { from: today, to: '2026-12-05' })
  assert.deepEqual(periodRange('1m', '2026-01-31'), { from: '2026-01-31', to: '2026-02-27' })
})

test('custom range is validated', () => {
  assert.equal(periodRange('custom', today, { from: '2026-11-10', to: '2026-11-01' }), null)
  assert.equal(periodRange('custom', today, { from: '', to: '2026-11-01' }), null)
  assert.deepEqual(periodRange('custom', today, { from: '2026-11-01', to: '2026-11-30' }), { from: '2026-11-01', to: '2026-11-30' })
})

test('addMonths clamps to the end of the month', () => {
  assert.equal(addMonths('2026-03-31', 1), '2026-04-30')
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15')
})

test('overdue and due never double count, done never counts', () => {
  const range = periodRange('custom', today, { from: '2026-11-01', to: '2026-11-08' })!
  const late = task({ deadline: '2026-11-03' })
  const due = task({ deadline: '2026-11-08' })
  const after = task({ deadline: '2026-11-09' })
  const done = task({ deadline: '2026-11-02', status: 'done' })
  assert.ok(isOverdue(late, today) && !isDueInRange(late, range, today))
  assert.ok(!isOverdue(due, today) && isDueInRange(due, range, today))
  assert.ok(!inBucket(after, 'all', range, today))
  assert.ok(!inBucket(done, 'all', range, today))
  const rows = loadByProject([late, due, after, done], range, today)
  assert.deepEqual(rows, [{ projectId: 'p1', overdue: 1, due: 1 }])
})

test('needs attention: overdue, today, tomorrow only, oldest first', () => {
  const a = task({ deadline: '2026-11-07' })
  const b = task({ deadline: '2026-11-01' })
  const c = task({ deadline: '2026-11-08' })
  const d = task({ deadline: today, priority: 'urgent' })
  assert.deepEqual(needsAttention([a, b, c, d], today).map((t) => t.id), [b.id, d.id, a.id])
})

test('focus today: my open non-blocked tasks, late then urgent then nearest', () => {
  const later = task({ deadline: '2026-11-20' })
  const urgent = task({ deadline: '2026-11-10', priority: 'urgent' })
  const late = task({ deadline: '2026-11-02' })
  const soon = task({ deadline: '2026-11-07' })
  const blocked = task({ deadline: '2026-11-01', status: 'blocked' })
  const other = task({ deadline: '2026-11-01', assignee_id: 'someone' })
  const inReview = task({ deadline: '2026-11-01', status: 'review', reviewer_id: 'someone' })
  assert.deepEqual(focusToday([later, urgent, late, soon, blocked, other, inReview], 'me', today).map((t) => t.id), [late.id, urgent.id, soon.id])
})
