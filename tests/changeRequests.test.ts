import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canDecide, dateIn, needsReminder, workingDaysBetween } from '../src/lib/changeRequests.ts'

test('working days skip Saturday and Sunday', () => {
  assert.equal(workingDaysBetween('2026-11-06', '2026-11-06'), 0)
  assert.equal(workingDaysBetween('2026-11-06', '2026-11-09'), 1) // Fri -> Mon
  assert.equal(workingDaysBetween('2026-11-06', '2026-11-10'), 2) // Fri -> Tue
  assert.equal(workingDaysBetween('2026-11-09', '2026-11-13'), 4) // Mon -> Fri
  assert.equal(workingDaysBetween('2026-11-07', '2026-11-08'), 0) // weekend only
})

test('a pending request needs a reminder after two working days, decided ones never', () => {
  const asked = { status: 'pending' as const, created_at: '2026-11-06T03:00:00Z' } // Fri 10:00 WIB
  assert.equal(needsReminder(asked, '2026-11-09', 'Asia/Jakarta'), false)
  assert.equal(needsReminder(asked, '2026-11-10', 'Asia/Jakarta'), true)
  assert.equal(needsReminder({ ...asked, status: 'approved' }, '2026-11-20', 'Asia/Jakarta'), false)
})

test('the date of a timestamp follows the timezone', () => {
  assert.equal(dateIn('2026-11-06T20:00:00Z', 'Asia/Jakarta'), '2026-11-07')
  assert.equal(dateIn('2026-11-06T20:00:00Z', 'UTC'), '2026-11-06')
})

test('the admin or the task owner decides, never the asker', () => {
  const task = { assignee_id: 'alfa', created_by: 'fadli' }
  const req = { requester_id: 'fauzi' }
  assert.equal(canDecide({ id: 'fadli', role: 'admin' }, req, task), true)
  assert.equal(canDecide({ id: 'alfa', role: 'member' }, req, task), true)
  assert.equal(canDecide({ id: 'fauzi', role: 'member' }, req, task), false)
  assert.equal(canDecide({ id: 'alfa', role: 'member' }, { requester_id: 'alfa' }, task), false)
  assert.equal(canDecide(null, req, task), false)
})
