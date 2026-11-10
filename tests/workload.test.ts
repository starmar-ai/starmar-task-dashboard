import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkload } from '../src/lib/workload.ts'

const today = '2026-11-10'
const people = [
  { id: 'fadli', active: true, full_name: 'Fadli', email: 'f@x' },
  { id: 'alfa', active: true, full_name: 'Alfarizi', email: 'a@x' },
  { id: 'gone', active: false, full_name: 'Gone', email: 'g@x' },
]
const task = (id: string, assignee_id: string | null, deadline: string, extra: Record<string, unknown> = {}) => ({
  id,
  assignee_id,
  deadline,
  status: 'todo' as const,
  priority: 'medium' as const,
  reviewer_id: null as string | null,
  ...extra,
})

test('counts open tasks per person and splits them by urgency of the deadline', () => {
  const rows = buildWorkload(
    [
      task('1', 'alfa', '2026-11-08'),
      task('2', 'alfa', '2026-11-10'),
      task('3', 'alfa', '2026-11-16'),
      task('4', 'alfa', '2026-11-17', { priority: 'urgent' }),
      task('5', 'alfa', '2026-11-01', { status: 'done' }),
      task('6', 'fadli', '2026-11-12'),
    ],
    people,
    today,
  )
  const alfa = rows.find((r) => r.personId === 'alfa')!
  assert.deepEqual([alfa.open, alfa.overdue, alfa.dueWeek, alfa.later, alfa.urgent], [4, 1, 2, 1, 1])
  assert.deepEqual(alfa.tasks.map((t) => t.id), ['1', '2', '3', '4'])
  assert.equal(rows[0].personId, 'alfa', 'busiest person first')
})

test('revoked people are left out; unassigned tasks get their own row only when they exist', () => {
  assert.deepEqual(buildWorkload([task('1', 'fadli', today)], people, today).map((r) => r.personId), ['fadli', 'alfa'])
  assert.deepEqual(buildWorkload([task('1', null, today)], people, today).map((r) => r.personId), ['fadli', 'alfa', null])
})

test('counts the tasks waiting in Review for a reviewer', () => {
  const rows = buildWorkload([task('1', 'alfa', today, { status: 'review', reviewer_id: 'fadli' })], people, today)
  assert.equal(rows.find((r) => r.personId === 'fadli')!.toReview, 1)
  assert.equal(rows.find((r) => r.personId === 'alfa')!.toReview, 0)
})
