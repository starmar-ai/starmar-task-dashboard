import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { formatDate } from '../lib/dates'
import type { Dates } from '../lib/gantt'
import type { Task } from '../lib/types'
import { Modal } from './Modal'

interface DialogProps {
  title: string
  before: Dates
  after: Dates
  /** The task waits for, or is waited on by, other tasks. Their dates stay as they are. */
  hasDependencies: boolean
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

/** Every change of a task's dates goes through this window: drag on the Gantt or edit in the task form. */
export function DateChangeDialog({ title, before, after, hasDependencies, busy, error, onConfirm, onCancel }: DialogProps) {
  const { t, locale } = useI18n()
  const show = (iso: string | null) => (iso ? formatDate(iso, locale) : t('dates.empty'))
  const startChanged = before.start !== after.start
  const endChanged = before.end !== after.end
  return (
    <Modal
      title={t('dates.confirmTitle')}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? t('common.saving') : t('dates.confirmYes')}
          </button>
        </>
      }
    >
      <p>{t('dates.confirmIntro', { title })}</p>
      <dl className="date-change">
        {startChanged && (
          <div>
            <dt>{t('taskForm.startDate')}</dt>
            <dd>
              <s>{show(before.start)}</s> <span aria-hidden="true">→</span> <strong>{show(after.start)}</strong>
            </dd>
          </div>
        )}
        {endChanged && (
          <div>
            <dt>{t('taskForm.deadline')}</dt>
            <dd>
              <s>{show(before.end)}</s> <span aria-hidden="true">→</span> <strong>{show(after.end)}</strong>
            </dd>
          </div>
        )}
      </dl>
      {hasDependencies && <p className="muted small">{t('dates.depsNote')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

export function sameDates(a: Dates, b: Dates) {
  return a.start === b.start && a.end === b.end
}

/** Asks first, then saves the new dates of one task. `onSaved` should reload the list. */
export function useDateChange(onSaved: () => void) {
  const { t } = useI18n()
  const [pending, setPending] = useState<{ task: Task; after: Dates; hasDependencies: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!pending) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('tasks').update({ start_date: pending.after.start, deadline: pending.after.end }).eq('id', pending.task.id)
    setBusy(false)
    if (error) return setError(errorMessage(t, error))
    setPending(null)
    onSaved()
  }

  const dialog = pending ? (
    <DateChangeDialog
      title={pending.task.title}
      before={{ start: pending.task.start_date, end: pending.task.deadline }}
      after={pending.after}
      hasDependencies={pending.hasDependencies}
      busy={busy}
      error={error}
      onConfirm={confirm}
      onCancel={() => {
        setPending(null)
        setError(null)
      }}
    />
  ) : null

  return {
    request: (task: Task, after: Dates, hasDependencies: boolean) => setPending({ task, after, hasDependencies }),
    dialog,
  }
}
