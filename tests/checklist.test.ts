import test from 'node:test'
import assert from 'node:assert/strict'
import { checklistProgress, moveItem, nextPosition } from '../src/lib/checklist.ts'

test('progress is null without items and rounds otherwise', () => {
  assert.equal(checklistProgress([]), null)
  assert.equal(checklistProgress(undefined), null)
  assert.deepEqual(checklistProgress([{ done: true }, { done: false }, { done: false }]), { done: 1, total: 3, pct: 33 })
  assert.equal(checklistProgress([{ done: true }])?.pct, 100)
})

test('nextPosition goes after the last item', () => {
  assert.equal(nextPosition([]), 1)
  assert.equal(nextPosition([{ position: 3 }, { position: 7 }]), 8)
})

test('moveItem swaps neighbours and stops at the edges', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c'])
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b'])
  assert.deepEqual(moveItem(['a', 'b'], 0, -1), ['a', 'b'])
  assert.deepEqual(moveItem(['a', 'b'], 1, 1), ['a', 'b'])
})
