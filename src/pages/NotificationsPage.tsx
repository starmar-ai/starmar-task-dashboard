import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { formatDate, formatDateTime } from '../lib/dates'
import { emitNotificationsChanged, notificationTarget, type NotificationRow } from '../lib/notifications'
import { EmptyState, ErrorState, LoadingState } from '../components/States'

type Tab = 'unread' | 'all'
const TABS: Tab[] = ['unread', 'all']

/** Events whose free text (comment, review note, decision note, reason) is worth showing under the sentence. */
const QUOTED = new Set(['comment', 'review_rejected', 'request_new', 'request_approved', 'request_rejected'])

const SELECT =
  'id, kind, event, task_id, actor_id, detail, field, urgent, created_at, read_at, ' +
  'task:tasks!task_id(id, title, deadline, project_id, projects(name, color)), actor:profiles!actor_id(full_name, email)'

export function NotificationsPage() {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const timezone = profile?.timezone ?? 'Asia/Jakarta'
  const [tab, setTab] = useState<Tab>('unread')
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('notifications').select(SELECT).order('created_at', { ascending: false }).limit(100)
    if (error) setLoadError(error.message)
    else {
      setLoadError(null)
      // A task that went to Trash or was deleted cannot be opened, so its news is not listed.
      setRows((data as unknown as NotificationRow[]).filter((r) => r.task))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function markRead(ids: string[] | null) {
    setActionError(null)
    const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids })
    if (error) return setActionError(errorMessage(t, error))
    const now = new Date().toISOString()
    setRows((prev) => prev.map((r) => (ids === null || ids.includes(r.id) ? { ...r, read_at: r.read_at ?? now } : r)))
    emitNotificationsChanged()
  }

  const unread = useMemo(() => rows.filter((r) => !r.read_at), [rows])
  const shown = tab === 'unread' ? unread : rows

  function sentence(n: NotificationRow): string {
    const who = n.actor ? n.actor.full_name || n.actor.email : t('notif.someone')
    const title = n.task?.title ?? ''
    const field = n.field ? t(`cr.field.${n.field as 'deadline'}`).toLowerCase() : ''
    const date = n.task ? formatDate(n.task.deadline, locale) : ''
    const vars = { who: n.event === 'team_overdue' ? (n.detail ?? '') : who, title, field, date }
    if (n.event === 'assigned' && !n.actor) return t('notif.event.assignedSelf', vars)
    return t(`notif.event.${n.event}`, vars)
  }

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <h1>{t('notif.title')}</h1>
          <p className="muted">{t('notif.hint')}</p>
        </div>
        <div className="notif-head-actions">
          <fieldset className="segmented segmented-sm view-switch">
            <legend className="sr-only">{t('notif.title')}</legend>
            {TABS.map((v) => (
              <label key={v} className={tab === v ? 'is-on' : ''}>
                <input type="radio" name="notif-tab" checked={tab === v} onChange={() => setTab(v)} />
                {t(`notif.tab.${v}`)}
                {v === 'unread' && unread.length > 0 ? ` (${unread.length})` : ''}
              </label>
            ))}
          </fieldset>
          <button type="button" className="btn btn-secondary btn-sm" disabled={unread.length === 0} onClick={() => markRead(null)}>
            {t('notif.markAll')}
          </button>
        </div>
      </header>

      <div aria-live="polite">
        {actionError && (
          <p className="form-error" role="alert">
            {actionError}
          </p>
        )}
      </div>

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('notif.loadError')} detail={loadError} onRetry={load} />
      ) : shown.length === 0 ? (
        <EmptyState>{t(`notif.empty.${tab}`)}</EmptyState>
      ) : (
        <ul className="notif-list">
          {shown.map((n) => (
            <li key={n.id} className={`notif ${n.read_at ? '' : 'is-unread'}`}>
              <div className="notif-body">
                <div className="notif-tags">
                  {!n.read_at && <span className="chip chip-new">{t('notif.new')}</span>}
                  {n.urgent && <span className="chip chip-priority-urgent">{t('notif.urgent')}</span>}
                </div>
                <p className="notif-text">{sentence(n)}</p>
                {n.detail && QUOTED.has(n.event) && <p className="notif-quote">{n.detail}</p>}
                <p className="notif-meta">
                  {n.task?.projects && (
                    <>
                      <span className="notif-dot" style={{ background: n.task.projects.color }} aria-hidden="true" />
                      <span>{n.task.projects.name}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <time dateTime={n.created_at}>{formatDateTime(n.created_at, locale, timezone)}</time>
                </p>
              </div>
              <div className="notif-actions">
                <Link to={notificationTarget(n)} className="btn btn-secondary btn-sm" onClick={() => !n.read_at && markRead([n.id])}>
                  {t('notif.open')}
                </Link>
                {!n.read_at && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => markRead([n.id])}>
                    {t('notif.markOne')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
