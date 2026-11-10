import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n, type TFn } from '../lib/i18n'
import { formatDate } from '../lib/dates'
import { CHANGE_FIELDS, CLEARABLE, DATE_FIELDS, type ChangeField } from '../lib/changeRequests'
import { pickablePeople } from '../lib/team'
import type { useLookups } from '../lib/useTeam'
import { PRIORITIES, type Locale, type Priority, type Profile, type Task } from '../lib/types'
import { Modal } from './Modal'

/** A stored request value as the person reads it: a date, a priority name, a person's name, or plain text. */
export function valueLabel(field: ChangeField, value: string | null, t: TFn, locale: Locale, people: Pick<Profile, 'id' | 'full_name' | 'email'>[]): string {
  if (value == null || value === '') return t('cr.empty')
  if (DATE_FIELDS.includes(field)) return formatDate(value, locale)
  if (field === 'priority') return t(`priority.${value as Priority}`)
  if (field === 'assignee_id') {
    const p = people.find((x) => x.id === value)
    return p ? p.full_name || p.email : t('cr.empty')
  }
  return value
}

function currentValue(task: Task, field: ChangeField): string {
  if (field === 'assignee_id') return task.assignee_id ?? ''
  if (field === 'priority') return task.priority
  if (field === 'start_date') return task.start_date ?? ''
  if (field === 'deadline') return task.deadline
  if (field === 'title') return task.title
  return task.description ?? ''
}

interface Props {
  task: Task
  lookups: ReturnType<typeof useLookups>
  onClose: () => void
  onSent: () => void
}

/** A member who does not own the task asks for one change, with a reason. Nothing changes until it is approved. */
export function ChangeRequestDialog({ task, lookups, onClose, onSent }: Props) {
  const { t, locale } = useI18n()
  const [field, setField] = useState<ChangeField>('deadline')
  const [value, setValue] = useState(currentValue(task, 'deadline'))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const owners = [task.assignee_id, task.created_by]
    .filter((id, i, all): id is string => !!id && all.indexOf(id) === i)
    .map((id) => lookups.people.find((p) => p.id === id))
    .filter((p): p is Profile => !!p)
    .map((p) => p.full_name || p.email)
  const names = owners.length ? owners.join(` ${t('common.or')} `) : t('cr.adminName')

  const project = lookups.projects.find((p) => p.id === task.project_id)
  const pickable = pickablePeople(lookups.people, project, lookups.members)

  function pickField(next: ChangeField) {
    setField(next)
    setValue(currentValue(task, next))
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!reason.trim()) return setError(t('error.crReason'))
    setBusy(true)
    const { error: err } = await supabase.rpc('submit_change_request', {
      p_task: task.id,
      p_field: field,
      p_value: value.trim() === '' ? null : value.trim(),
      p_reason: reason.trim(),
    })
    setBusy(false)
    if (err) return setError(errorMessage(t, err))
    onSent()
  }

  const clearable = CLEARABLE.includes(field)

  return (
    <Modal
      title={t('cr.dialogTitle')}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="cr-form" className="btn btn-primary" disabled={busy}>
            {busy ? t('cr.sending') : t('cr.send')}
          </button>
        </>
      }
    >
      <p>{t('cr.dialogIntro', { names })}</p>
      <p className="muted small cr-task">{task.title}</p>
      <form id="cr-form" className="form-grid cr-form" onSubmit={submit}>
        <div className="field span-2">
          <label htmlFor="cr-field">{t('cr.field')}</label>
          <select id="cr-field" value={field} onChange={(e) => pickField(e.target.value as ChangeField)}>
            {CHANGE_FIELDS.map((f) => (
              <option key={f} value={f}>
                {t(`cr.field.${f}`)}
              </option>
            ))}
          </select>
          <span className="muted small">{t('cr.current', { value: valueLabel(field, currentValue(task, field), t, locale, lookups.people) })}</span>
        </div>
        <div className="field span-2">
          <label htmlFor="cr-value">{t('cr.newValue')}</label>
          {field === 'description' ? (
            <textarea id="cr-value" rows={3} maxLength={5000} value={value} onChange={(e) => setValue(e.target.value)} />
          ) : field === 'priority' ? (
            <select id="cr-value" value={value} onChange={(e) => setValue(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </select>
          ) : field === 'assignee_id' ? (
            <select id="cr-value" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {pickable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          ) : DATE_FIELDS.includes(field) ? (
            <input id="cr-value" type="date" required={!clearable} value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input id="cr-value" required maxLength={200} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
          {clearable && field !== 'assignee_id' && <span className="muted small">{t('cr.clearHint')}</span>}
        </div>
        <div className="field span-2">
          <label htmlFor="cr-reason">
            {t('cr.reason')} <span className="req" aria-hidden="true">*</span>
          </label>
          <textarea id="cr-reason" rows={3} required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="cr-reason-hint" />
          <span id="cr-reason-hint" className="muted small">
            {t('cr.reasonHint')}
          </span>
        </div>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
