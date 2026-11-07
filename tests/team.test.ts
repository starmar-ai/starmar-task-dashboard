import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canOpenProject, inviteState, pickablePeople } from '../src/lib/team.ts'

const fadli = { id: 'fadli', role: 'admin' as const, active: true }
const alfa = { id: 'alfa', role: 'member' as const, active: true }
const fauzi = { id: 'fauzi', role: 'member' as const, active: true }
const gone = { id: 'gone', role: 'member' as const, active: false }
const web = { id: 'web', pm_id: null }
const ads = { id: 'ads', pm_id: 'fauzi' }
const members = [
  { project_id: 'web', user_id: 'alfa' },
  { project_id: 'web', user_id: 'gone' },
]

test('admin, PM, and members can open a project; revoked people cannot', () => {
  assert.equal(canOpenProject(fadli, web, members), true)
  assert.equal(canOpenProject(alfa, web, members), true)
  assert.equal(canOpenProject(fauzi, web, members), false)
  assert.equal(canOpenProject(fauzi, ads, members), true)
  assert.equal(canOpenProject(gone, web, members), false)
  assert.equal(canOpenProject(alfa, undefined, members), false)
})

test('pickers list only people with access, plus the current pick', () => {
  const people = [fadli, alfa, fauzi, gone]
  assert.deepEqual(pickablePeople(people, web, members).map((p) => p.id), ['fadli', 'alfa'])
  assert.deepEqual(pickablePeople(people, web, members, ['fauzi', null]).map((p) => p.id), ['fadli', 'alfa', 'fauzi'])
})

test('invite state', () => {
  assert.equal(inviteState({ active: false }, undefined), 'revoked')
  assert.equal(inviteState({ active: true }, { user_id: 'x', invited_at: '2026-11-07', joined_at: null, last_sign_in_at: null }), 'pending')
  assert.equal(inviteState({ active: true }, { user_id: 'x', invited_at: '2026-11-07', joined_at: '2026-11-07', last_sign_in_at: null }), 'active')
  assert.equal(inviteState({ active: true }, undefined), 'active')
})
