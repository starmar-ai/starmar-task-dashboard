// Sends the notification emails. Runs as a Vercel Function and is called only by the database
// (pg_cron once an hour for the daily summary, a trigger for urgent tasks), never by the browser.
// Every call must carry the shared secret in "Authorization: Bearer <NOTIFY_SECRET>".
//
// Env on Vercel: NOTIFY_SECRET, RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY (already there for the
// team function), and optionally NOTIFY_FROM and APP_URL.
import { timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export type Locale = 'id' | 'en'

export interface Person {
  id: string
  email: string
  full_name: string
  locale: Locale
  timezone: string
}

export interface Settings {
  email_daily: boolean
  email_urgent: boolean
  digest_sent_on: string | null
}

export interface Item {
  id: string
  event: string
  field: string | null
  detail: string | null
  urgent: boolean
  actor_name: string | null
  task_title: string
  task_deadline: string
  project_name: string
}

export interface Email {
  to: string
  subject: string
  html: string
  text: string
}

export interface Mailer {
  send(email: Email): Promise<void>
}

/** The slice of the database this function uses; tests pass a fake. */
export interface NotifyBackend {
  person(userId: string): Promise<{ person: Person; settings: Settings } | null>
  /** One notification, with whether it still waits for an email. */
  urgentItem(id: string): Promise<{ userId: string; item: Item; pending: boolean; emailNow: boolean } | null>
  activePeople(): Promise<{ person: Person; settings: Settings }[]>
  /** Unread notifications of this person that no email has carried yet, newest first. */
  unsentItems(userId: string): Promise<Item[]>
  markEmailed(ids: string[]): Promise<void>
  markDigestSent(userId: string, localDate: string): Promise<void>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LISTED = 30

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Local time ---------------------------------------------------------------------------------

export function localClock(now: Date, timezone: string): { date: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), weekday }
}

/** The daily summary goes out from 08:00 local time, Monday to Friday, once per day. */
export function digestDue(now: Date, person: Person, settings: Settings): boolean {
  if (!settings.email_daily) return false
  const { date, hour, weekday } = localClock(now, person.timezone)
  return hour >= 8 && weekday <= 5 && settings.digest_sent_on !== date
}

// Wording ------------------------------------------------------------------------------------

const FIELDS: Record<Locale, Record<string, string>> = {
  id: { title: 'judul', description: 'deskripsi', priority: 'prioritas', start_date: 'tanggal mulai', deadline: 'deadline', assignee_id: 'penanggung jawab' },
  en: { title: 'title', description: 'description', priority: 'priority', start_date: 'start date', deadline: 'deadline', assignee_id: 'assignee' },
}

function shortDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
}

/** One sentence for one notification. Mirrors the bell in the app. */
export function describe(locale: Locale, item: Item): string {
  const who = item.actor_name || (locale === 'id' ? 'Seseorang' : 'Someone')
  const title = `"${item.task_title}"`
  const field = FIELDS[locale][item.field ?? ''] ?? item.field ?? ''
  const note = item.detail ? ` ${item.detail}` : ''
  const date = shortDate(item.task_deadline, locale)
  if (locale === 'id') {
    switch (item.event) {
      case 'assigned':
        return item.actor_name ? `${who} menugaskan ${title} ke kamu.` : `Kamu ditugaskan ke ${title}.`
      case 'due_tomorrow':
        return `${title} jatuh tempo ${date}, hari kerja berikutnya.`
      case 'due_today':
        return `${title} jatuh tempo hari ini.`
      case 'overdue':
        return `${title} sudah lewat deadline (${date}).`
      case 'team_overdue':
        return `${title} milik ${item.detail || 'tim'} sudah lewat deadline lebih dari sehari (${date}).`
      case 'review_requested':
        return `${who} minta kamu mereview ${title}.`
      case 'review_approved':
        return `${who} menyetujui ${title}. Tugas jadi Done.`
      case 'review_rejected':
        return `${who} minta revisi ${title}.${note}`
      case 'comment':
        return `${who} berkomentar di ${title}:${note}`
      case 'request_new':
        return `${who} mengajukan perubahan ${field} untuk ${title}.`
      case 'request_approved':
        return `Permintaan perubahan ${field} untuk ${title} disetujui.${note}`
      case 'request_rejected':
        return `Permintaan perubahan ${field} untuk ${title} ditolak.${note}`
      case 'request_stale':
        return `Permintaan perubahan ${field} untuk ${title} belum dijawab 2 hari kerja.`
      case 'unblocked':
        return `${title} tidak terblokir lagi, sudah bisa dikerjakan.`
    }
  } else {
    switch (item.event) {
      case 'assigned':
        return item.actor_name ? `${who} assigned ${title} to you.` : `You were assigned to ${title}.`
      case 'due_tomorrow':
        return `${title} is due ${date}, the next working day.`
      case 'due_today':
        return `${title} is due today.`
      case 'overdue':
        return `${title} is past its deadline (${date}).`
      case 'team_overdue':
        return `${title} (${item.detail || 'team'}) has been overdue for more than a day (${date}).`
      case 'review_requested':
        return `${who} asked you to review ${title}.`
      case 'review_approved':
        return `${who} approved ${title}. The task is Done.`
      case 'review_rejected':
        return `${who} asked for changes on ${title}.${note}`
      case 'comment':
        return `${who} commented on ${title}:${note}`
      case 'request_new':
        return `${who} asked to change the ${field} of ${title}.`
      case 'request_approved':
        return `Your request to change the ${field} of ${title} was approved.${note}`
      case 'request_rejected':
        return `Your request to change the ${field} of ${title} was rejected.${note}`
      case 'request_stale':
        return `The request to change the ${field} of ${title} has waited 2 working days.`
      case 'unblocked':
        return `${title} is no longer blocked and can be worked on.`
    }
  }
  return title
}

/** Things that need action today come first. */
const WEIGHT: Record<string, number> = {
  overdue: 0,
  team_overdue: 1,
  due_today: 2,
  review_requested: 3,
  review_rejected: 3,
  request_new: 4,
  request_stale: 4,
  due_tomorrow: 5,
}

export function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => Number(b.urgent) - Number(a.urgent) || (WEIGHT[a.event] ?? 9) - (WEIGHT[b.event] ?? 9))
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const COPY = {
  id: {
    subject: (n: number) => (n === 1 ? 'Starmar AI: 1 hal buat kamu hari ini' : `Starmar AI: ${n} hal buat kamu hari ini`),
    urgentSubject: (title: string) => `Urgent di Starmar AI: ${title}`,
    hello: (name: string) => `Halo ${name},`,
    intro: 'Ini ringkasan notifikasi kamu pagi ini.',
    urgentIntro: 'Ada kabar untuk tugas yang berprioritas urgent.',
    urgentTag: 'URGENT',
    more: (n: number) => `Dan ${n} lainnya di aplikasi.`,
    open: 'Buka dashboard',
    footer: 'Atur apa yang masuk ke email di Pengaturan.',
  },
  en: {
    subject: (n: number) => (n === 1 ? 'Starmar AI: 1 thing for you today' : `Starmar AI: ${n} things for you today`),
    urgentSubject: (title: string) => `Urgent on Starmar AI: ${title}`,
    hello: (name: string) => `Hi ${name},`,
    intro: 'Here is your notification summary for this morning.',
    urgentIntro: 'There is news on a task with urgent priority.',
    urgentTag: 'URGENT',
    more: (n: number) => `And ${n} more in the app.`,
    open: 'Open the dashboard',
    footer: 'Choose what reaches your email in Settings.',
  },
}

function render(person: Person, items: Item[], appUrl: string, subject: string, intro: string): Email {
  const locale = person.locale
  const c = COPY[locale]
  const shown = items.slice(0, MAX_LISTED)
  const rest = items.length - shown.length
  const name = person.full_name || person.email

  const rows = shown
    .map((it) => {
      const tag = it.urgent ? `<span style="display:inline-block;margin-right:6px;padding:0 8px;border:2px solid #2B2A6B;border-radius:999px;background:#FF6B57;font-size:11px;font-weight:800;">${c.urgentTag}</span>` : ''
      return `<li style="margin:0 0 10px;padding:10px 12px;border:2px solid #2B2A6B;border-radius:12px;background:#FFFFFF;"><div style="font-size:15px;line-height:1.45;">${tag}${esc(describe(locale, it))}</div><div style="margin-top:2px;font-size:13px;color:#5B5A8C;">${esc(it.project_name)}</div></li>`
    })
    .join('')

  const html =
    `<!doctype html><html lang="${locale}"><body style="margin:0;padding:24px 12px;background:#FAF6EC;font-family:Arial,Helvetica,sans-serif;color:#2B2A6B;">` +
    `<div style="max-width:560px;margin:0 auto;">` +
    `<p style="margin:0 0 16px;font-size:20px;font-weight:800;">Starmar AI</p>` +
    `<p style="margin:0 0 4px;font-size:16px;font-weight:700;">${esc(c.hello(name))}</p>` +
    `<p style="margin:0 0 16px;font-size:15px;">${esc(intro)}</p>` +
    `<ul style="margin:0 0 16px;padding:0;list-style:none;">${rows}</ul>` +
    (rest > 0 ? `<p style="margin:0 0 16px;font-size:14px;">${esc(c.more(rest))}</p>` : '') +
    `<p style="margin:0 0 20px;"><a href="${esc(appUrl)}/notifications" style="display:inline-block;padding:10px 20px;border:2px solid #2B2A6B;border-radius:999px;background:#FFD23F;color:#2B2A6B;font-weight:800;text-decoration:none;box-shadow:3px 3px 0 #2B2A6B;">${esc(c.open)}</a></p>` +
    `<p style="margin:0;font-size:13px;color:#5B5A8C;">${esc(c.footer)} <a href="${esc(appUrl)}/settings" style="color:#2B2A6B;">${esc(appUrl)}/settings</a></p>` +
    `</div></body></html>`

  const text =
    `${c.hello(name)}\n\n${intro}\n\n` +
    shown.map((it) => `- ${it.urgent ? `[${c.urgentTag}] ` : ''}${describe(locale, it)} (${it.project_name})`).join('\n') +
    (rest > 0 ? `\n${c.more(rest)}` : '') +
    `\n\n${c.open}: ${appUrl}/notifications\n${c.footer} ${appUrl}/settings\n`

  return { to: person.email, subject, html, text }
}

export function renderDigest(person: Person, items: Item[], appUrl: string): Email {
  const sorted = sortItems(items)
  const c = COPY[person.locale]
  return render(person, sorted, appUrl, c.subject(sorted.length), c.intro)
}

export function renderUrgent(person: Person, item: Item, appUrl: string): Email {
  const c = COPY[person.locale]
  return render(person, [item], appUrl, c.urgentSubject(item.task_title), c.urgentIntro)
}

// Handler ------------------------------------------------------------------------------------

export interface NotifyOptions {
  secret: string | undefined
  appUrl: string
  now?: Date
}

export async function handleNotify(request: Request, backend: NotifyBackend | null, mailer: Mailer | null, options: NotifyOptions): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!backend || !mailer || !options.secret) return json(503, { error: 'server_not_configured' })

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token || !secretMatches(token, options.secret)) return json(401, { error: 'unauthorized' })

  let body: { mode?: string; id?: string | null }
  try {
    body = (await request.json()) as { mode?: string; id?: string | null }
  } catch {
    return json(400, { error: 'bad_request' })
  }
  const now = options.now ?? new Date()

  try {
    if (body.mode === 'urgent') {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) return json(400, { error: 'bad_request' })
      const found = await backend.urgentItem(body.id)
      if (!found || !found.pending || !found.emailNow) return json(200, { sent: 0, skipped: 'nothing_to_send' })
      const who = await backend.person(found.userId)
      // Someone who switched urgent emails off still gets the item in the daily summary.
      if (!who || !who.settings.email_urgent) return json(200, { sent: 0, skipped: 'urgent_email_off' })
      await mailer.send(renderUrgent(who.person, found.item, options.appUrl))
      await backend.markEmailed([found.item.id])
      return json(200, { sent: 1 })
    }

    if (body.mode === 'digest') {
      let sent = 0
      const failed: string[] = []
      for (const { person, settings } of await backend.activePeople()) {
        if (!digestDue(now, person, settings)) continue
        const items = await backend.unsentItems(person.id)
        if (items.length === 0) continue
        try {
          await mailer.send(renderDigest(person, items, options.appUrl))
          await backend.markEmailed(items.map((i) => i.id))
          await backend.markDigestSent(person.id, localClock(now, person.timezone).date)
          sent++
        } catch (err) {
          // Not marked as sent, so the next hourly run tries this person again.
          failed.push(`${person.email}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      return json(200, { sent, failed })
    }

    return json(400, { error: 'bad_request' })
  } catch (err) {
    return json(500, { error: 'failed', detail: err instanceof Error ? err.message : String(err) })
  }
}

// Real backends --------------------------------------------------------------------------------

function resendMailer(): Mailer | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  const from = process.env.NOTIFY_FROM || 'Starmar AI <onboarding@resend.dev>'
  return {
    async send(email) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
      })
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
    },
  }
}

interface NotificationRow {
  id: string
  user_id: string
  event: string
  field: string | null
  detail: string | null
  urgent: boolean
  email_now: boolean
  emailed_at: string | null
  actor_id: string | null
  task_id: string
}

function supabaseBackend(): NotifyBackend | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const check = <T extends { error: { message: string } | null }>(res: T): T => {
    if (res.error) throw new Error(res.error.message)
    return res
  }
  const defaults: Settings = { email_daily: true, email_urgent: true, digest_sent_on: null }

  async function toItems(rows: NotificationRow[]): Promise<Item[]> {
    if (rows.length === 0) return []
    const taskIds = [...new Set(rows.map((r) => r.task_id))]
    const { data: tasks } = check(await db.from('tasks').select('id, title, deadline, projects(name)').in('id', taskIds))
    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => Boolean(x)))]
    const { data: actors } = actorIds.length ? check(await db.from('profiles').select('id, full_name, email').in('id', actorIds)) : { data: [] }
    const taskById = new Map((tasks ?? []).map((t) => [t.id as string, t as unknown as { title: string; deadline: string; projects: { name: string } | null }]))
    const nameById = new Map((actors ?? []).map((a) => [a.id as string, (a.full_name as string) || (a.email as string)]))
    return rows.flatMap((r) => {
      const t = taskById.get(r.task_id)
      if (!t) return []
      return [
        {
          id: r.id,
          event: r.event,
          field: r.field,
          detail: r.detail,
          urgent: r.urgent,
          actor_name: r.actor_id ? (nameById.get(r.actor_id) ?? null) : null,
          task_title: t.title,
          task_deadline: t.deadline,
          project_name: t.projects?.name ?? '',
        },
      ]
    })
  }

  async function people(ids: string[] | null) {
    let q = db.from('profiles').select('id, email, full_name, locale, timezone').eq('active', true)
    if (ids) q = q.in('id', ids)
    const { data: profiles } = check(await q)
    const list = profiles ?? []
    const { data: settings } = list.length
      ? check(await db.from('notification_settings').select('user_id, email_daily, email_urgent, digest_sent_on').in('user_id', list.map((p) => p.id as string)))
      : { data: [] }
    const settingsById = new Map((settings ?? []).map((s) => [s.user_id as string, s as unknown as Settings]))
    return list.map((p) => ({ person: p as unknown as Person, settings: settingsById.get(p.id as string) ?? defaults }))
  }

  return {
    async person(userId) {
      return (await people([userId]))[0] ?? null
    },
    async urgentItem(id) {
      const { data } = check(await db.from('notifications').select('id, user_id, event, field, detail, urgent, email_now, emailed_at, actor_id, task_id').eq('id', id).maybeSingle())
      if (!data) return null
      const row = data as unknown as NotificationRow
      const [item] = await toItems([row])
      if (!item) return null
      return { userId: row.user_id, item, pending: row.emailed_at === null, emailNow: row.email_now }
    },
    activePeople() {
      return people(null)
    },
    async unsentItems(userId) {
      const { data } = check(
        await db
          .from('notifications')
          .select('id, user_id, event, field, detail, urgent, email_now, emailed_at, actor_id, task_id')
          .eq('user_id', userId)
          .is('emailed_at', null)
          .is('read_at', null)
          .order('created_at', { ascending: false })
          .limit(200),
      )
      return toItems((data ?? []) as unknown as NotificationRow[])
    },
    async markEmailed(ids) {
      if (ids.length) check(await db.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', ids))
    },
    async markDigestSent(userId, localDate) {
      check(await db.from('notification_settings').upsert({ user_id: userId, digest_sent_on: localDate }, { onConflict: 'user_id' }))
    },
  }
}

export function POST(request: Request): Promise<Response> {
  return handleNotify(request, supabaseBackend(), resendMailer(), {
    secret: process.env.NOTIFY_SECRET,
    appUrl: (process.env.APP_URL || 'https://starmar-task-dashboard.vercel.app').replace(/\/$/, ''),
  })
}
