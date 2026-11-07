import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { formatDate } from '../lib/dates'
import { indexDependencies, wouldCreateCycle } from '../lib/taskFlow'
import type { Task, TaskDependency } from '../lib/types'
import { StatusChip } from './Chips'
import { ErrorState, LoadingState } from './States'

type Brief = Pick<Task, 'id' | 'title' | 'status' | 'deadline' | 'project_id'>

interface Props {
  task: Task
  canManage: boolean
  /** Called with the task's fresh status after the list changed (it may have become Blocked or unblocked). */
  onChanged: (fresh: Pick<Task, 'status' | 'blocked_from'>) => void
}

export function TaskDependencies({ task, canManage, onChanged }: Props) {
  const { t, locale } = useI18n()
  const [deps, setDeps] = useState<TaskDependency[]>([])
  const [briefs, setBriefs] = useState<Brief[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const depRes = await supabase.from('task_dependencies').select('task_id, depends_on_id')
    if (depRes.error) {
      setLoadError(depRes.error.message)
      setLoading(false)
      return
    }
    const all = depRes.data as TaskDependency[]
    // Linked tasks can sit in another project if one was moved, so fetch those by id as well.
    const linked = all.filter((d) => d.task_id === task.id || d.depends_on_id === task.id).flatMap((d) => [d.task_id, d.depends_on_id])
    const ids = [...new Set(linked)].filter((id) => id !== task.id)
    const filter = ids.length ? `project_id.eq.${task.project_id},id.in.(${ids.join(',')})` : `project_id.eq.${task.project_id}`
    const taskRes = await supabase.from('tasks').select('id, title, status, deadline, project_id').or(filter).order('deadline')
    if (taskRes.error) setLoadError(taskRes.error.message)
    else {
      setDeps(all)
      setBriefs(taskRes.data as Brief[])
    }
    setLoading(false)
  }, [task.id, task.project_id])

  useEffect(() => {
    load()
  }, [load])

  const byId = useMemo(() => new Map(briefs.map((b) => [b.id, b])), [briefs])
  const index = useMemo(() => indexDependencies(deps), [deps])
  const waitsFor = (index.waitsFor.get(task.id) ?? []).map((id) => byId.get(id)).filter((b): b is Brief => !!b)
  const waitedBy = (index.waitedBy.get(task.id) ?? []).map((id) => byId.get(id)).filter((b): b is Brief => !!b)
  const candidates = briefs.filter(
    (b) => b.id !== task.id && b.project_id === task.project_id && !waitsFor.some((w) => w.id === b.id) && !wouldCreateCycle(deps, task.id, b.id),
  )

  async function afterChange() {
    await load()
    const { data } = await supabase.from('tasks').select('status, blocked_from').eq('id', task.id).single()
    if (data) onChanged(data as Pick<Task, 'status' | 'blocked_from'>)
  }

  async function add() {
    if (!pick) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('task_dependencies').insert({ task_id: task.id, depends_on_id: pick })
    if (error) {
      setBusy(false)
      return setError(errorMessage(t, error))
    }
    setPick('')
    await afterChange()
    setBusy(false)
  }

  async function remove(dependsOnId: string) {
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('task_dependencies').delete().eq('task_id', task.id).eq('depends_on_id', dependsOnId)
    if (error) {
      setBusy(false)
      return setError(errorMessage(t, error))
    }
    await afterChange()
    setBusy(false)
  }

  return (
    <section className="task-extra" aria-labelledby="deps-title">
      <div className="task-extra-head">
        <h3 id="deps-title">{t('deps.title')}</h3>
      </div>
      <p className="muted small">{t('deps.hint')}</p>

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('deps.loadError')} detail={loadError} onRetry={load} />
      ) : (
        <>
          {waitsFor.length === 0 ? (
            <p className="task-extra-empty">{t('deps.empty')}</p>
          ) : (
            <ul className="resource-list dep-list">
              {waitsFor.map((b) => (
                <li key={b.id} className="dep">
                  <StatusChip status={b.status} />
                  <div className="resource-body">
                    <span className="resource-name">{b.title}</span>
                    <span className="muted small">
                      {formatDate(b.deadline, locale)}
                      {b.status !== 'done' && b.deadline > task.deadline && (
                        <span className="dep-late"> · {t('deps.lateWarn', { date: formatDate(b.deadline, locale) })}</span>
                      )}
                    </span>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => remove(b.id)}
                      aria-label={t('deps.remove', { title: b.title })}
                    >
                      {t('files.remove')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage &&
            (candidates.length === 0 ? (
              <p className="muted small">{t('deps.noCandidates')}</p>
            ) : (
              <div className="inline-add">
                <div className="field grow">
                  <label htmlFor="dep-pick">{t('deps.pick')}</label>
                  <select id="dep-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">{t('deps.pickNone')}</option>
                    {candidates.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title} ({t(`status.${b.status}`)}, {formatDate(b.deadline, locale)})
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !pick} onClick={add}>
                  {t('deps.add')}
                </button>
              </div>
            ))}

          {waitedBy.length > 0 && (
            <div className="dep-waited">
              <p className="field-label">{t('deps.waitedBy')}</p>
              <ul className="dep-chips">
                {waitedBy.map((b) => (
                  <li key={b.id}>
                    <StatusChip status={b.status} /> {b.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
