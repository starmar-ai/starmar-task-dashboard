// Admin-only team actions that need the Supabase service key: invite, new invite link, revoke, restore.
// Runs as a Vercel Function. The service key stays on the server (env SUPABASE_SERVICE_ROLE_KEY).
import { createClient } from '@supabase/supabase-js'

export type TeamAction =
  | { action: 'invite'; email: string; full_name?: string; project_ids?: string[]; send_email?: boolean }
  | { action: 'set_active'; user_id: string; active: boolean }

interface Caller {
  id: string
  role: string
  active: boolean
}

/** The slice of the Supabase admin client this function uses; tests pass a fake. */
export interface TeamBackend {
  callerFromToken(token: string): Promise<Caller | null>
  findProfileByEmail(email: string): Promise<{ id: string; joined: boolean; active: boolean } | null>
  inviteByEmail(email: string, fullName: string, redirectTo: string | undefined): Promise<{ userId: string }>
  inviteLink(email: string, fullName: string, redirectTo: string | undefined): Promise<{ userId: string; link: string }>
  activate(userId: string, fullName: string): Promise<void>
  addToProjects(userId: string, projectIds: string[]): Promise<void>
  profile(userId: string): Promise<{ role: string } | null>
  setBanned(userId: string, banned: boolean): Promise<void>
  setActive(userId: string, active: boolean): Promise<void>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

// Supabase still checks this against Authentication > URL Configuration > Redirect URLs.
function redirectFrom(request: Request): string | undefined {
  const origin = request.headers.get('origin') ?? ''
  return /^https:\/\/[a-z0-9.-]+$/i.test(origin) || /^http:\/\/localhost:\d+$/.test(origin) ? `${origin}/` : undefined
}

export async function handleTeam(request: Request, backend: TeamBackend | null): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!backend) return json(503, { error: 'server_not_configured' })

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  let caller: Caller | null = null
  try {
    caller = token ? await backend.callerFromToken(token) : null
  } catch (err) {
    return json(500, { error: 'failed', detail: err instanceof Error ? err.message : String(err) })
  }
  if (!caller || caller.role !== 'admin' || !caller.active) return json(403, { error: 'admin_only' })

  let body: TeamAction
  try {
    body = (await request.json()) as TeamAction
  } catch {
    return json(400, { error: 'bad_request' })
  }

  try {
    if (body.action === 'invite') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const fullName = String(body.full_name ?? '').trim().slice(0, 80)
      const projectIds = Array.isArray(body.project_ids) ? body.project_ids.filter((p) => typeof p === 'string' && UUID.test(p)) : []
      if (!EMAIL.test(email) || email.length > 254) return json(400, { error: 'invalid_email' })

      const existing = await backend.findProfileByEmail(email)
      // Revoked or never-invited accounts go through restore, which also lifts the sign-in ban.
      if (existing && (existing.joined || !existing.active)) return json(409, { error: 'already_joined' })

      const redirectTo = redirectFrom(request)
      let userId: string
      let link: string | null = null
      if (body.send_email) {
        userId = (await backend.inviteByEmail(email, fullName, redirectTo)).userId
      } else {
        const res = await backend.inviteLink(email, fullName, redirectTo)
        userId = res.userId
        link = res.link
      }
      await backend.activate(userId, fullName)
      if (projectIds.length) await backend.addToProjects(userId, projectIds)
      return json(200, { user_id: userId, link })
    }

    if (body.action === 'set_active') {
      if (!UUID.test(String(body.user_id))) return json(400, { error: 'bad_request' })
      if (body.user_id === caller.id) return json(400, { error: 'cannot_revoke_self' })
      const target = await backend.profile(body.user_id)
      if (!target) return json(404, { error: 'not_found' })
      if (!body.active && target.role === 'admin') return json(400, { error: 'cannot_revoke_admin' })
      // Ban first so a revoked person cannot sign in again even if the profile update fails.
      await backend.setBanned(body.user_id, !body.active)
      await backend.setActive(body.user_id, Boolean(body.active))
      return json(200, { ok: true })
    }

    return json(400, { error: 'bad_request' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/rate limit/i.test(message)) return json(429, { error: 'email_rate_limit', detail: message })
    if (/already been registered|email_exists/i.test(message)) return json(409, { error: 'already_joined' })
    return json(500, { error: 'failed', detail: message })
  }
}

function supabaseBackend(): TeamBackend | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const check = <T extends { error: { message: string } | null }>(res: T): T => {
    if (res.error) throw new Error(res.error.message)
    return res
  }

  return {
    async callerFromToken(token) {
      const { data, error } = await db.auth.getUser(token)
      if (error || !data.user) return null
      // A failed read (wrong key, missing column) must not look like "not an admin".
      const { data: p, error: profileError } = await db.from('profiles').select('id, role, active').eq('id', data.user.id).maybeSingle()
      if (profileError) throw new Error(`profiles: ${profileError.message}`)
      return (p as Caller | null) ?? null
    },
    async findProfileByEmail(email) {
      const { data } = check(await db.from('profiles').select('id, active').eq('email', email).maybeSingle())
      if (!data) return null
      const { data: u } = check(await db.auth.admin.getUserById(data.id as string))
      return { id: data.id as string, joined: Boolean(u.user?.email_confirmed_at), active: data.active !== false }
    },
    async inviteByEmail(email, fullName, redirectTo) {
      const { data } = check(await db.auth.admin.inviteUserByEmail(email, { data: fullName ? { full_name: fullName } : {}, redirectTo }))
      return { userId: data.user!.id }
    },
    async inviteLink(email, fullName, redirectTo) {
      const { data } = check(
        await db.auth.admin.generateLink({ type: 'invite', email, options: { data: fullName ? { full_name: fullName } : {}, redirectTo } }),
      )
      if (!data.user || !data.properties) throw new Error('invite link was not created')
      return { userId: data.user.id, link: data.properties.action_link }
    },
    async activate(userId, fullName) {
      const patch: Record<string, unknown> = { active: true }
      if (fullName) patch.full_name = fullName
      check(await db.from('profiles').update(patch).eq('id', userId))
    },
    async addToProjects(userId, projectIds) {
      check(
        await db
          .from('project_members')
          .upsert(projectIds.map((project_id) => ({ project_id, user_id: userId })), { onConflict: 'project_id,user_id', ignoreDuplicates: true }),
      )
    },
    async profile(userId) {
      const { data } = check(await db.from('profiles').select('role').eq('id', userId).maybeSingle())
      return (data as { role: string } | null) ?? null
    },
    async setBanned(userId, banned) {
      check(await db.auth.admin.updateUserById(userId, { ban_duration: banned ? '876000h' : 'none' }))
    },
    async setActive(userId, active) {
      check(await db.from('profiles').update({ active }).eq('id', userId))
    },
  }
}

export function POST(request: Request): Promise<Response> {
  return handleTeam(request, supabaseBackend())
}
