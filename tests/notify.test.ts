import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describe, digestDue, handleNotify, localClock, renderDigest, sortItems, type Item, type NotifyBackend, type Person, type Settings, type Email } from '../api/notify.ts'

const SECRET = 'rahasia-test'
const ID = '30000000-0000-0000-0000-000000000001'

const fadli: Person = { id: 'u1', email: 'fadli@example.com', full_name: 'Fadli', locale: 'id', timezone: 'Asia/Jakarta' }
const defaults: Settings = { email_daily: true, email_urgent: true, digest_sent_on: null }

function item(over: Partial<Item> = {}): Item {
  return { id: 'n1', event: 'due_today', field: null, detail: null, urgent: false, actor_name: null, task_title: 'Desain banner', task_deadline: '2026-11-12', project_name: 'Peluncuran', ...over }
}

function fake(over: Partial<NotifyBackend> = {}, settings: Settings = defaults, items: Item[] = [item()]) {
  const log = { emailed: [] as string[], digestDates: [] as string[] }
  const backend: NotifyBackend = {
    async person() {
      return { person: fadli, settings }
    },
    async urgentItem(id) {
      return id === ID ? { userId: 'u1', item: item({ urgent: true, event: 'assigned' }), pending: true, emailNow: true } : null
    },
    async activePeople() {
      return [{ person: fadli, settings }]
    },
    async unsentItems() {
      return items
    },
    async markEmailed(ids) {
      log.emailed.push(...ids)
    },
    async markDigestSent(_u, date) {
      log.digestDates.push(date)
    },
    ...over,
  }
  const sent: Email[] = []
  const mailer = {
    async send(e: Email) {
      sent.push(e)
    },
  }
  return { backend, mailer, sent, log }
}

const call = (body: unknown, token = SECRET) =>
  new Request('https://x.test/api/notify', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
// Wednesday 2026-11-11, 08:30 in Jakarta (01:30 UTC).
const MORNING = new Date('2026-11-11T01:30:00Z')
const opts = { secret: SECRET, appUrl: 'https://app.test', now: MORNING }

test('wrong or missing secret is refused', async () => {
  const f = fake()
  assert.equal((await handleNotify(call({ mode: 'digest' }, 'nope'), f.backend, f.mailer, opts)).status, 401)
  assert.equal((await handleNotify(call({ mode: 'digest' }, ''), f.backend, f.mailer, opts)).status, 401)
  assert.equal(f.sent.length, 0)
})

test('not configured answers 503 instead of sending', async () => {
  const f = fake()
  assert.equal((await handleNotify(call({ mode: 'digest' }), null, f.mailer, opts)).status, 503)
  assert.equal((await handleNotify(call({ mode: 'digest' }), f.backend, null, opts)).status, 503)
  assert.equal((await handleNotify(call({ mode: 'digest' }), f.backend, f.mailer, { ...opts, secret: undefined })).status, 503)
})

test('digest: one email at 08:00 local, then not again the same day', async () => {
  const f = fake()
  const res = await handleNotify(call({ mode: 'digest' }), f.backend, f.mailer, opts)
  assert.deepEqual(await res.json(), { sent: 1, failed: [] })
  assert.equal(f.sent.length, 1)
  assert.deepEqual(f.log.emailed, ['n1'])
  assert.deepEqual(f.log.digestDates, ['2026-11-11'])

  const again = fake({}, { ...defaults, digest_sent_on: '2026-11-11' })
  await handleNotify(call({ mode: 'digest' }), again.backend, again.mailer, opts)
  assert.equal(again.sent.length, 0)
})

test('digest waits before 08:00, skips weekends, respects the switch and empty days', async () => {
  const early = new Date('2026-11-10T23:30:00Z') // 06:30 Jakarta
  assert.equal(digestDue(early, fadli, defaults), false)
  const saturday = new Date('2026-11-14T02:00:00Z')
  assert.equal(digestDue(saturday, fadli, defaults), false)
  assert.equal(digestDue(MORNING, fadli, { ...defaults, email_daily: false }), false)
  assert.equal(digestDue(MORNING, fadli, defaults), true)

  const empty = fake({}, defaults, [])
  await handleNotify(call({ mode: 'digest' }), empty.backend, empty.mailer, opts)
  assert.equal(empty.sent.length, 0)
})

test('digest: a failed send is not marked, so the next hour retries', async () => {
  const f = fake()
  const failing = { async send(): Promise<void> { throw new Error('resend 403') } }
  const res = await handleNotify(call({ mode: 'digest' }), f.backend, failing, opts)
  const body = (await res.json()) as { sent: number; failed: string[] }
  assert.equal(body.sent, 0)
  assert.match(body.failed[0], /resend 403/)
  assert.deepEqual(f.log.emailed, [])
  assert.deepEqual(f.log.digestDates, [])
})

test('urgent: sends once, only when the person keeps urgent emails on', async () => {
  const f = fake()
  assert.deepEqual(await (await handleNotify(call({ mode: 'urgent', id: ID }), f.backend, f.mailer, opts)).json(), { sent: 1 })
  assert.match(f.sent[0].subject, /^Urgent di Starmar AI/)
  assert.deepEqual(f.log.emailed, ['n1'])

  const off = fake({}, { ...defaults, email_urgent: false })
  await handleNotify(call({ mode: 'urgent', id: ID }), off.backend, off.mailer, opts)
  assert.equal(off.sent.length, 0)

  const done = fake({ urgentItem: async () => ({ userId: 'u1', item: item(), pending: false, emailNow: true }) })
  await handleNotify(call({ mode: 'urgent', id: ID }), done.backend, done.mailer, opts)
  assert.equal(done.sent.length, 0)
})

test('bad requests', async () => {
  const f = fake()
  assert.equal((await handleNotify(call({ mode: 'urgent', id: 'not-a-uuid' }), f.backend, f.mailer, opts)).status, 400)
  assert.equal((await handleNotify(call({ mode: 'whatever' }), f.backend, f.mailer, opts)).status, 400)
  assert.equal((await handleNotify(new Request('https://x.test/api/notify'), f.backend, f.mailer, opts)).status, 405)
})

test('local clock follows the timezone', () => {
  assert.deepEqual(localClock(new Date('2026-11-11T17:30:00Z'), 'Asia/Jakarta'), { date: '2026-11-12', hour: 0, weekday: 4 })
  assert.equal(localClock(new Date('2026-11-11T17:30:00Z'), 'Asia/Jayapura').hour, 2)
})

test('wording: both languages, no em dash, urgent first, html escaped', () => {
  for (const event of ['assigned', 'due_tomorrow', 'due_today', 'overdue', 'team_overdue', 'review_requested', 'review_approved', 'review_rejected', 'comment', 'request_new', 'request_approved', 'request_rejected', 'request_stale', 'unblocked']) {
    for (const locale of ['id', 'en'] as const) {
      const s = describe(locale, item({ event, field: 'deadline', actor_name: 'Alfarizi', detail: 'catatan' }))
      assert.ok(s.includes('Desain banner'), `${locale} ${event}`)
      assert.ok(!s.includes('—'), `${locale} ${event} has an em dash`)
    }
  }
  const sorted = sortItems([item({ id: 'a', event: 'due_tomorrow' }), item({ id: 'b', event: 'overdue' }), item({ id: 'c', event: 'comment', urgent: true })])
  assert.deepEqual(sorted.map((i) => i.id), ['c', 'b', 'a'])

  const mail = renderDigest(fadli, [item({ task_title: '<script>x</script>' })], 'https://app.test')
  assert.ok(!mail.html.includes('<script>'))
  assert.ok(mail.html.includes('https://app.test/notifications'))
  assert.equal(mail.subject, 'Starmar AI: 1 hal buat kamu hari ini')
  assert.ok(!mail.html.includes('—') && !mail.text.includes('—'))
})
