import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { checklistProgress, moveItem, nextPosition } from '../lib/checklist'
import { emitTasksChanged } from '../lib/taskEvents'
import type { ChecklistItem, Task } from '../lib/types'
import { ErrorState, LoadingState } from './States'

interface Props {
  task: Pick<Task, 'id' | 'project_id' | 'deadline'>
  canManage: boolean
  /** Tells the list behind the modal to reload so its progress badge is fresh. */
  onChanged?: () => void
}

export function TaskChecklist({ task, canManage, onChanged }: Props) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase
      .from('task_checklist_items')
      .select('*')
      .eq('task_id', task.id)
      .order('position')
      .order('created_at')
    if (error) setLoadError(error.message)
    else setItems(data as ChecklistItem[])
    setLoading(false)
  }, [task.id])

  useEffect(() => {
    load()
  }, [load])

  const progress = checklistProgress(items)

  async function add(e?: FormEvent) {
    e?.preventDefault()
    const text = title.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('task_checklist_items')
      .insert({ task_id: task.id, title: text, position: nextPosition(items) })
      .select('*')
      .single()
    setBusy(false)
    if (error) return setError(errorMessage(t, error))
    setItems((prev) => [...prev, data as ChecklistItem])
    setTitle('')
    onChanged?.()
  }

  async function toggle(item: ChecklistItem) {
    setError(null)
    const done = !item.done
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done } : i)))
    const { error } = await supabase.from('task_checklist_items').update({ done }).eq('id', item.id)
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)))
      return setError(errorMessage(t, error))
    }
    onChanged?.()
  }

  async function saveEdit(item: ChecklistItem) {
    const text = editTitle.trim()
    setEditingId(null)
    if (!text || text === item.title) return
    setError(null)
    const { error } = await supabase.from('task_checklist_items').update({ title: text }).eq('id', item.id)
    if (error) return setError(errorMessage(t, error))
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, title: text } : i)))
  }

  async function remove(item: ChecklistItem) {
    setError(null)
    const { error } = await supabase.from('task_checklist_items').delete().eq('id', item.id)
    if (error) return setError(errorMessage(t, error))
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    onChanged?.()
  }

  async function move(index: number, dir: -1 | 1) {
    const next = moveItem(items, index, dir)
    if (next === items) return
    setError(null)
    const renumbered = next.map((i, n) => ({ ...i, position: n + 1 }))
    setItems(renumbered)
    const changed = renumbered.filter((i) => i.position !== items.find((o) => o.id === i.id)?.position)
    const results = await Promise.all(changed.map((i) => supabase.from('task_checklist_items').update({ position: i.position }).eq('id', i.id)))
    const failed = results.find((r) => r.error)
    if (failed?.error) {
      setError(errorMessage(t, failed.error))
      load()
    }
  }

  async function toTask(item: ChecklistItem) {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: insErr } = await supabase.from('tasks').insert({
      title: item.title,
      project_id: task.project_id,
      deadline: task.deadline,
      assignee_id: profile?.id ?? null,
    })
    if (insErr) {
      setBusy(false)
      return setError(errorMessage(t, insErr))
    }
    const { error: delErr } = await supabase.from('task_checklist_items').delete().eq('id', item.id)
    setBusy(false)
    if (delErr) return setError(errorMessage(t, delErr))
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    emitTasksChanged()
    onChanged?.()
  }

  return (
    <section className="task-extra" aria-labelledby="checklist-title">
      <header className="task-extra-head">
        <h3 id="checklist-title">{progress ? t('checklist.titleCount', { done: progress.done, total: progress.total }) : t('checklist.title')}</h3>
      </header>

      {progress && (
        <div
          className="progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.pct}
          aria-label={t('checklist.progress', { done: progress.done, total: progress.total })}
        >
          <span style={{ width: `${progress.pct}%` }} />
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('checklist.loadError')} detail={loadError} onRetry={load} />
      ) : items.length === 0 ? (
        <p className="task-extra-empty">{canManage ? t('checklist.empty') : t('checklist.emptyReadOnly')}</p>
      ) : (
        <ul className="check-list">
          {items.map((item, index) => (
            <li key={item.id} className={`check-item ${item.done ? 'is-done' : ''}`}>
              <input
                type="checkbox"
                className="check-box"
                checked={item.done}
                disabled={!canManage}
                onChange={() => toggle(item)}
                aria-label={t('checklist.tick', { title: item.title })}
              />
              {editingId === item.id ? (
                <input
                  className="check-edit"
                  autoFocus
                  maxLength={200}
                  value={editTitle}
                  aria-label={t('checklist.rename')}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => saveEdit(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(item)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                />
              ) : canManage ? (
                <button
                  type="button"
                  className="check-title"
                  onClick={() => {
                    setEditingId(item.id)
                    setEditTitle(item.title)
                  }}
                  title={t('checklist.rename')}
                >
                  {item.title}
                </button>
              ) : (
                <span className="check-title">{item.title}</span>
              )}
              {canManage && (
                <span className="check-actions">
                  <button type="button" className="icon-btn" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('checklist.up', { title: item.title })} title={t('checklist.up', { title: item.title })}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button type="button" className="icon-btn" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={t('checklist.down', { title: item.title })} title={t('checklist.down', { title: item.title })}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button type="button" className="btn btn-sm check-to-task" onClick={() => toTask(item)} disabled={busy} title={t('checklist.toTaskHint')}>
                    {t('checklist.toTask')}
                  </button>
                  <button type="button" className="icon-btn" onClick={() => remove(item)} aria-label={t('checklist.remove', { title: item.title })} title={t('checklist.remove', { title: item.title })}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form className="check-form" onSubmit={add}>
          <label htmlFor="check-new" className="sr-only">
            {t('checklist.new')}
          </label>
          <input id="check-new" maxLength={200} placeholder={t('checklist.placeholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>
            {t('checklist.add')}
          </button>
        </form>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
