import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardColumn, canReview, needsReviewer, planMove, wouldCreateCycle } from '../src/lib/taskFlow.ts'

const admin = { id: 'fadli', role: 'admin' as const }
const owner = { id: 'alfa', role: 'member' as const }
const reviewer = { id: 'fauzi', role: 'member' as const }
const outsider = { id: 'other', role: 'member' as const }

const base = { status: 'in_progress' as const, blocked_from: null, assignee_id: 'alfa', created_by: 'alfa', reviewer_id: null }
const reviewed = { ...base, reviewer_id: 'fauzi' }

test('owner moves a task without a reviewer anywhere', () => {
  assert.deepEqual(planMove(owner, base, 'done'), { kind: 'update', status: 'done' })
  assert.deepEqual(planMove(owner, base, 'review'), { kind: 'update', status: 'review' })
  assert.equal(planMove(owner, base, 'in_progress'), null)
})

test('blocked tasks cannot be moved, and nobody sets Blocked by hand', () => {
  assert.deepEqual(planMove(admin, { ...base, status: 'blocked', blocked_from: 'todo' }, 'done'), { kind: 'denied', reason: 'blocked' })
  assert.deepEqual(planMove(owner, base, 'blocked'), { kind: 'denied', reason: 'blocked' })
})

test('with a reviewer, the owner sends to Review but cannot finish', () => {
  assert.deepEqual(planMove(owner, reviewed, 'done'), { kind: 'denied', reason: 'needs_review' })
  assert.deepEqual(planMove(owner, reviewed, 'review'), { kind: 'update', status: 'review' })
  assert.equal(needsReviewer(owner, reviewed), true)
  assert.equal(needsReviewer(admin, reviewed), false)
})

test('reviewer approves or rejects a task in Review', () => {
  const inReview = { ...reviewed, status: 'review' as const }
  assert.deepEqual(planMove(reviewer, inReview, 'done'), { kind: 'approve' })
  assert.deepEqual(planMove(reviewer, inReview, 'in_progress'), { kind: 'reject' })
  assert.deepEqual(planMove(reviewer, inReview, 'todo'), { kind: 'denied', reason: 'no_access' })
  assert.deepEqual(planMove(admin, inReview, 'done'), { kind: 'approve' })
  assert.deepEqual(planMove(owner, inReview, 'in_progress'), { kind: 'update', status: 'in_progress' })
})

test('others cannot move the task', () => {
  assert.deepEqual(planMove(outsider, base, 'review'), { kind: 'denied', reason: 'no_access' })
  assert.equal(canReview(outsider, reviewed), false)
  assert.equal(canReview(admin, base), false)
})

test('a blocked card stays in the column it returns to', () => {
  assert.equal(boardColumn({ status: 'blocked', blocked_from: 'review' }), 'review')
  assert.equal(boardColumn({ status: 'blocked', blocked_from: null }), 'todo')
  assert.equal(boardColumn({ status: 'done', blocked_from: null }), 'done')
})

test('dependency loops are detected, direct and further down', () => {
  const deps = [
    { task_id: 'B', depends_on_id: 'A' },
    { task_id: 'C', depends_on_id: 'B' },
  ]
  assert.equal(wouldCreateCycle(deps, 'A', 'C'), true)
  assert.equal(wouldCreateCycle(deps, 'A', 'B'), true)
  assert.equal(wouldCreateCycle(deps, 'A', 'A'), true)
  assert.equal(wouldCreateCycle(deps, 'C', 'A'), false)
  assert.equal(wouldCreateCycle(deps, 'D', 'C'), false)
})
