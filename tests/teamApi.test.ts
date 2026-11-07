import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleTeam, type TeamBackend } from '../api/team.ts'

const ADMIN = '00000000-0000-0000-0000-00000000000a'
const MEMBER = '00000000-0000-0000-0000-00000000000b'
const PROJECT = '10000000-0000-0000-0000-000000000001'

function fakeBackend(overrides: Partial<TeamBackend> = {}) {
  const calls: string[] = []
  const backend: TeamBackend = {
    async callerFromToken(token) {
      if (token === 'admin') return { id: ADMIN, role: 'admin', active: true }
      if (token === 'member') return { id: MEMBER, role: 'member', active: true }
      if (token === 'revoked-admin') return { id: ADMIN, role: 'admin', active: false }
      return null
    },
    async findProfileByEmail(email) {
      if (email === 'joined@example.com') return { id: MEMBER, joined: true, active: true }
      if (email === 'revoked@example.com') return { id: MEMBER, joined: false, active: false }
      return null
    },
    async inviteByEmail(email) {
      calls.push(`email:${email}`)
      return { userId: 'new-user' }
    },
    async inviteLink(email) {
      calls.push(`link:${email}`)
      return { userId: 'new-user', link: 'https://example.supabase.co/auth/v1/verify?token=abc&type=invite' }
    },
    async activate(userId, fullName) {
      calls.push(`activate:${userId}:${fullName}`)
    },
    async addToProjects(userId, ids) {
      calls.push(`projects:${userId}:${ids.join(',')}`)
    },
    async profile(userId) {
      return userId === ADMIN ? { role: 'admin' } : { role: 'member' }
    },
    async setBanned(userId, banned) {
      calls.push(`ban:${userId}:${banned}`)
    },
    async setActive(userId, active) {
      calls.push(`active:${userId}:${active}`)
    },
    ...overrides,
  }
  return { backend, calls }
}

function req(token: string | null, body: unknown, origin = 'https://starmar-task-dashboard.vercel.app') {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin }
  if (token) headers.authorization = `Bearer ${token}`
  return new Request('https://x/api/team', { method: 'POST', headers, body: JSON.stringify(body) })
}

test('only an active admin can use the team API', async () => {
  const { backend, calls } = fakeBackend()
  const body = { action: 'invite', email: 'a@example.com' }
  assert.equal((await handleTeam(req(null, body), backend)).status, 403)
  assert.equal((await handleTeam(req('member', body), backend)).status, 403)
  assert.equal((await handleTeam(req('revoked-admin', body), backend)).status, 403)
  assert.equal((await handleTeam(req('garbage', body), backend)).status, 403)
  assert.deepEqual(calls, [])
})

test('missing server key is reported, not crashed on', async () => {
  const res = await handleTeam(req('admin', { action: 'invite', email: 'a@example.com' }), null)
  assert.equal(res.status, 503)
  assert.deepEqual(await res.json(), { error: 'server_not_configured' })
})

test('invite by link activates the person and adds valid project ids only', async () => {
  const { backend, calls } = fakeBackend()
  const res = await handleTeam(
    req('admin', { action: 'invite', email: ' Alfa@Example.com ', full_name: 'Alfarizi', project_ids: [PROJECT, 'not-a-uuid'] }),
    backend,
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.match(body.link, /type=invite/)
  assert.deepEqual(calls, ['link:alfa@example.com', 'activate:new-user:Alfarizi', `projects:new-user:${PROJECT}`])
})

test('invite by email sends no link back', async () => {
  const { backend, calls } = fakeBackend()
  const res = await handleTeam(req('admin', { action: 'invite', email: 'b@example.com', send_email: true }), backend)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).link, null)
  assert.deepEqual(calls, ['email:b@example.com', 'activate:new-user:'])
})

test('bad emails, people who joined, and revoked people are refused', async () => {
  const { backend, calls } = fakeBackend()
  assert.equal((await handleTeam(req('admin', { action: 'invite', email: 'nope' }), backend)).status, 400)
  const res = await handleTeam(req('admin', { action: 'invite', email: 'joined@example.com' }), backend)
  assert.equal(res.status, 409)
  const revoked = await handleTeam(req('admin', { action: 'invite', email: 'revoked@example.com' }), backend)
  assert.equal(revoked.status, 409)
  assert.deepEqual(calls, [])
})

test('revoke bans and deactivates, but never the caller or another admin', async () => {
  const { backend, calls } = fakeBackend()
  assert.equal((await handleTeam(req('admin', { action: 'set_active', user_id: MEMBER, active: false }), backend)).status, 200)
  assert.deepEqual(calls, [`ban:${MEMBER}:true`, `active:${MEMBER}:false`])

  const self = await handleTeam(req('admin', { action: 'set_active', user_id: ADMIN, active: false }), backend)
  assert.deepEqual(await self.json(), { error: 'cannot_revoke_self' })

  const other = fakeBackend({ profile: async () => ({ role: 'admin' }) })
  const res = await handleTeam(req('admin', { action: 'set_active', user_id: MEMBER, active: false }), other.backend)
  assert.deepEqual(await res.json(), { error: 'cannot_revoke_admin' })
  assert.deepEqual(other.calls, [])
})

test('restore lifts the ban and reactivates', async () => {
  const { backend, calls } = fakeBackend()
  assert.equal((await handleTeam(req('admin', { action: 'set_active', user_id: MEMBER, active: true }), backend)).status, 200)
  assert.deepEqual(calls, [`ban:${MEMBER}:false`, `active:${MEMBER}:true`])
})

test('email rate limit comes back as its own error', async () => {
  const { backend } = fakeBackend({
    inviteByEmail: async () => {
      throw new Error('email rate limit exceeded')
    },
  })
  const res = await handleTeam(req('admin', { action: 'invite', email: 'c@example.com', send_email: true }), backend)
  assert.equal(res.status, 429)
})
