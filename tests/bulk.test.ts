import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planBulkStatus, runEach, selectable } from '../src/lib/bulk.ts'

const admin = { id: 'fadli', role: 'admin' as const }
const alfa = { id: 'alfa', role: 'member' as const }

const task = (id: string, extra: object = {}) => ({
  id,
  status: 'todo' as const,
  blocked_from: null,
  assignee_id: 'alfa',
  created_by: 'alfa',
  reviewer_id: null,
  ...extra,
})

test('members can only tick their own tasks, the admin ticks all', () => {
  const list = [task('a'), task('b', { assignee_id: 'fauzi', created_by: 'fauzi' })]
  assert.deepEqual(selectable(alfa, list).map((x) => x.id), ['a'])
  assert.deepEqual(selectable(admin, list).map((x) => x.id), ['a', 'b'])
})

test('bulk status follows the single-task rules', () => {
  const list = [
    task('plain'),
    task('same', { status: 'done' }),
    task('blocked', { status: 'blocked', blocked_from: 'todo' }),
    task('reviewed', { reviewer_id: 'fauzi' }),
    task('inreview', { status: 'review', reviewer_id: 'fadli' }),
  ]
  assert.deepEqual(planBulkStatus(admin, list, 'done'), [
    { id: 'plain', kind: 'update', status: 'done' },
    { id: 'same', kind: 'skip', reason: 'same' },
    { id: 'blocked', kind: 'skip', reason: 'blocked' },
    { id: 'reviewed', kind: 'update', status: 'done' },
    { id: 'inreview', kind: 'approve' },
  ])
  assert.deepEqual(
    planBulkStatus(alfa, [task('reviewed', { reviewer_id: 'fauzi' })], 'done'),
    [{ id: 'reviewed', kind: 'skip', reason: 'needs_review' }],
  )
})

test('rejecting from a bulk change is skipped because it needs a note', () => {
  const inReview = task('x', { status: 'review', reviewer_id: 'fadli' })
  assert.deepEqual(planBulkStatus(admin, [inReview], 'in_progress'), [{ id: 'x', kind: 'skip', reason: 'review_note' }])
})

test('runEach counts successes and failures and keeps going', async () => {
  const result = await runEach([{ id: '1' }, { id: '2' }, { id: '3' }], async (item) => (item.id === '2' ? { message: 'nope' } : null))
  assert.deepEqual(result, { done: 2, skipped: 0, failed: 1, firstError: 'nope' })
})
