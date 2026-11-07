import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { emitTasksChanged } from '../lib/taskEvents'
import type { Task } from '../lib/types'
import { TaskForm } from '../pages/TaskForm'

/** Floating "Tambah Tugas" button on every page. It opens a small panel at the bottom center, and "Show details" opens the full form. */
export function QuickAddTask() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      {!open && (
        <button type="button" className="fab" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          {t('tasks.add')}
        </button>
      )}
      {open && <Panel onClose={() => setOpen(false)} />}
    </>
  )
}

function Panel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const titleRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [details, setDetails] = useState(false)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  useEffect(() => {
    if (details) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [details, onClose])

  const projects = lookups.projects.filter((p) => !p.archived)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setAdded(null)
    if (!title.trim() || !projectId || !deadline) return setError(t('taskForm.required'))
    setBusy(true)
    const { error: insErr } = await supabase.from('tasks').insert({ title: title.trim(), project_id: projectId, deadline })
    setBusy(false)
    if (insErr) return setError(errorMessage(t, insErr))
    setAdded(title.trim())
    setTitle('')
    emitTasksChanged()
    titleRef.current?.focus()
  }

  if (details) {
    const draft: Task = {
      id: '',
      project_id: projectId,
      title,
      description: null,
      status: 'todo',
      priority: 'medium',
      start_date: null,
      deadline,
      assignee_id: profile?.id ?? null,
      reviewer_id: null,
      created_by: profile?.id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      blocked_from: null,
      review_note: null,
      review_note_by: null,
      review_note_at: null,
      task_labels: [],
    }
    return (
      <TaskForm
        task={draft}
        lookups={lookups}
        onClose={() => setDetails(false)}
        onSaved={() => {
          emitTasksChanged()
          onClose()
        }}
        onDeleted={() => undefined}
      />
    )
  }

  return (
    <form className="quick-pop" role="dialog" aria-label={t('tasks.add')} onSubmit={onSubmit}>
      <div className="quick-pop-head">
        <h2>{t('tasks.add')}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="quick-pop-grid">
        <div className="field quick-title">
          <label htmlFor="qa-title">{t('tasks.quickTitle')}</label>
          <input id="qa-title" ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tasks.quickPlaceholder')} maxLength={200} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="qa-project">{t('taskForm.project')}</label>
          <select id="qa-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t('tasks.pickProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="qa-deadline">{t('taskForm.deadline')}</label>
          <input id="qa-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      <p className="quick-pop-added" role="status">
        {added ? t('tasks.added', { title: added }) : ''}
      </p>
      <div className="quick-pop-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setDetails(true)}>
          {t('tasks.showDetails')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? t('tasks.adding') : t('tasks.add')}
        </button>
      </div>
    </form>
  )
}
