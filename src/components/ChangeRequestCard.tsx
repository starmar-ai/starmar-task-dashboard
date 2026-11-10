import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { formatDateTime, todayIn } from '../lib/dates'
import { canDecide, dateIn, DATE_FIELDS, needsReminder, workingDaysBetween, type ChangeRequest } from '../lib/changeRequests'
import { emitTasksChanged } from '../lib/taskEvents'
import { emitRequestsChanged } from '../lib/requestEvents'
import type { Profile, Task } from '../lib/types'
import { Modal } from './Modal'
import { DateChangeDialog } from './TaskDateChange'
import { valueLabel } from './ChangeRequestDialog'
import { ErrorState, LoadingState } from './States'

type People = Pick<Profile, 'id' | 'full_name' | 'email'>[]

interface CardProps {
  request: ChangeRequest
  /** Needed to decide (owner check) and to confirm date changes. */
  task: Task | undefined
  people: People
  /** Show the task title above the change; the task's own form already says which task it is. */
  showTask?: boolean
  onDone?: () => void
}

function nameOf(people: People, id: string | null): string {
  const p = people.find((x) => x.id === id)
  return p ? p.full_name || p.email : '?'
}

/** One change request: what was asked, why, and who decided what. Actions appear for the people allowed to use them. */
export function ChangeRequestCard({ request, task, people, showTask, onDone }: CardProps) {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const timezone = profile?.timezone ?? 'Asia/Jakarta'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDates, setConfirmDates] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  const pending = request.status === 'pending'
  const mayDecide = pending && canDecide(profile, request, task)
  const mine = pending && !!profile && request.requester_id === profile.id
  const fieldName = t(`cr.field.${request.field}`)
  const waited = pending ? workingDaysBetween(dateIn(request.created_at, timezone), todayIn(timezone)) : 0
  const stale = needsReminder(request, todayIn(timezone), timezone)

  async function run(fn: () => PromiseLike<{ error: { message?: string; code?: string } | null }>, after?: () => void) {
    setBusy(true)
    setError(null)
    const { error: err } = await fn()
    setBusy(false)
    if (err) return setError(errorMessage(t, err))
    after?.()
    emitRequestsChanged()
    onDone?.()
  }

  const decide = (approve: boolean, text?: string) =>
    run(
      () => supabase.rpc('decide_change_request', { p_id: request.id, p_approve: approve, p_note: text ?? null }),
      () => {
        setConfirmDates(false)
        setRejecting(false)
        if (approve) emitTasksChanged()
      },
    )

  function approve() {
    if (DATE_FIELDS.includes(request.field) && task) setConfirmDates(true)
    else decide(true)
  }

  const dateAfter = task
    ? request.field === 'deadline'
      ? { start: task.start_date, end: request.new_value ?? task.deadline }
      : { start: request.new_value, end: task.deadline }
    : null

  const decidedWord = t(`cr.decided${request.status === 'approved' ? 'Approved' : request.status === 'rejected' ? 'Rejected' : 'Cancelled'}`)

  return (
    <li className={`cr-card cr-${request.status}`}>
      <div className="cr-head">
        <span className={`chip chip-cr-${request.status}`}>{t(`cr.status.${request.status}`)}</span>
        {stale && (
          <span className="chip chip-overdue">
            <span aria-hidden="true" className="chip-glyph">
              !
            </span>
            {t('cr.stale', { n: waited })}
          </span>
        )}
        <span className="muted small">
          {t('cr.asked', { name: nameOf(people, request.requester_id), date: formatDateTime(request.created_at, locale, timezone) })}
        </span>
      </div>
      {showTask && <p className="cr-task-title">{task ? task.title : t('cr.taskGone')}</p>}
      <p className="cr-change">
        <strong>{fieldName}</strong>
        <span className="cr-values">
          <s>{valueLabel(request.field, request.old_value, t, locale, people)}</s> <span aria-hidden="true">→</span>{' '}
          <strong>{valueLabel(request.field, request.new_value, t, locale, people)}</strong>
        </span>
      </p>
      <p className="cr-reason">{t('cr.reasonLabel', { text: request.reason })}</p>
      {!pending && request.decided_at && (
        <p className="muted small">
          {t('cr.decided', { name: nameOf(people, request.decided_by), status: decidedWord, date: formatDateTime(request.decided_at, locale, timezone) })}
          {request.decision_note ? `. ${t('cr.noteLabel', { text: request.decision_note })}` : ''}
        </p>
      )}
      {(mayDecide || mine) && (
        <div className="cr-actions">
          {mayDecide && (
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={approve} aria-label={t('cr.approveFor', { field: fieldName, title: task?.title ?? '' })}>
                {t('cr.approve')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRejecting(true)} aria-label={t('cr.rejectFor', { field: fieldName, title: task?.title ?? '' })}>
                {t('cr.reject')}
              </button>
            </>
          )}
          {mine && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => supabase.rpc('cancel_change_request', { p_id: request.id }))}>
              {t('cr.withdraw')}
            </button>
          )}
        </div>
      )}
      {error && !confirmDates && !rejecting && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {confirmDates && task && dateAfter && (
        <DateChangeDialog
          title={task.title}
          before={{ start: task.start_date, end: task.deadline }}
          after={dateAfter}
          hasDependencies={false}
          busy={busy}
          error={error}
          onConfirm={() => decide(true)}
          onCancel={() => {
            setConfirmDates(false)
            setError(null)
          }}
        />
      )}
      {rejecting && (
        <Modal
          title={t('cr.rejectTitle')}
          size="sm"
          onClose={() => {
            setRejecting(false)
            setError(null)
          }}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setRejecting(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-danger" disabled={busy || !note.trim()} onClick={() => decide(false, note.trim())}>
                {t('cr.rejectConfirm')}
              </button>
            </>
          }
        >
          <p>{t('cr.rejectIntro', { name: nameOf(people, request.requester_id) })}</p>
          <div className="field">
            <label htmlFor={`cr-note-${request.id}`}>{t('cr.rejectNote')}</label>
            <textarea id={`cr-note-${request.id}`} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </li>
  )
}

/** The requests on one task, inside the task form. The asker sees their own; the owner and the admin see all. */
export function TaskChangeRequests({ task, people, refreshKey, onChanged }: { task: Task; people: People; refreshKey: number; onChanged?: () => void }) {
  const { t } = useI18n()
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase.from('change_requests').select('*').eq('task_id', task.id).order('created_at', { ascending: false })
    if (error) setLoadError(error.message)
    else setRequests(data as ChangeRequest[])
    setLoading(false)
  }, [task.id])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  // Nothing to show and nothing wrong: stay out of the way.
  if (!loading && !loadError && requests.length === 0) return null

  return (
    <section className="task-extra" aria-labelledby="cr-title">
      <header className="task-extra-head">
        <h3 id="cr-title">{t('cr.taskTitle')}</h3>
      </header>
      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('requests.loadError')} detail={loadError} onRetry={load} />
      ) : (
        <ul className="cr-list">
          {requests.map((r) => (
            <ChangeRequestCard
              key={r.id}
              request={r}
              task={task}
              people={people}
              onDone={() => {
                load()
                onChanged?.()
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

