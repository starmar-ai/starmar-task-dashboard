import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useTasksChanged } from '../lib/taskEvents'
import { useLookups } from '../lib/useTeam'
import { daysBetween, formatDate, todayIn } from '../lib/dates'
import { buildWorkload } from '../lib/workload'
import type { Task } from '../lib/types'
import { Avatar, PriorityChip, ProjectName, StatusChip } from '../components/Chips'
import { EmptyState, ErrorState, LoadingState } from '../components/States'
import { TaskForm } from './TaskForm'

export function WorkloadPage() {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const today = todayIn(profile?.timezone ?? 'Asia/Jakarta')

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useState('')
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase.from('tasks').select('*, task_labels(label_id)').neq('status', 'done').order('deadline')
    if (error) setLoadError(error.message)
    else setTasks(data as Task[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useTasksChanged(load)

  const projectById = useMemo(() => new Map(lookups.projects.map((p) => [p.id, p])), [lookups.projects])
  const inScope = useMemo(
    () => tasks.filter((x) => (projectFilter ? x.project_id === projectFilter : !projectById.get(x.project_id)?.archived)),
    [tasks, projectFilter, projectById],
  )
  const rows = useMemo(() => buildWorkload(inScope, lookups.people, today), [inScope, lookups.people, today])
  const personById = useMemo(() => new Map(lookups.people.map((p) => [p.id, p])), [lookups.people])
  const widest = Math.max(1, ...rows.map((r) => r.open))
  const nothing = !loading && !loadError && inScope.length === 0

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('workload.title')}</h1>
          <p className="muted">{t('workload.hint')}</p>
        </div>
        <div className="filters">
          <div className="field field-inline">
            <label htmlFor="wl-project">{t('tasks.filterProject')}</label>
            <select id="wl-project" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">{t('tasks.allProjects')}</option>
              {lookups.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {loading || lookups.loading ? (
        <LoadingState />
      ) : loadError || lookups.error ? (
        <ErrorState
          message={t('workload.loadError')}
          detail={loadError ?? lookups.error ?? undefined}
          onRetry={() => {
            load()
            lookups.reload()
          }}
        />
      ) : nothing ? (
        <EmptyState>{t('workload.empty')}</EmptyState>
      ) : (
        <>
          <ul className="wl-legend" aria-hidden="true">
            <li>
              <i className="wl-seg wl-seg-overdue" /> {t('workload.overdue')}
            </li>
            <li>
              <i className="wl-seg wl-seg-week" /> {t('workload.week')}
            </li>
            <li>
              <i className="wl-seg wl-seg-later" /> {t('workload.later')}
            </li>
          </ul>
          <ul className="wl-list">
            {rows.map((row) => {
              const key = row.personId ?? 'none'
              const person = row.personId ? personById.get(row.personId) : undefined
              const name = person ? person.full_name || person.email : t('workload.unassigned')
              const isOpen = openRow === key
              const listId = `wl-tasks-${key}`
              return (
                <li key={key} className="wl-row">
                  <div className="wl-main">
                    <div className="wl-person">
                      {person ? <Avatar name={name} /> : null}
                      <div>
                        <strong>
                          {name}
                          {person?.id === profile?.id && <span className="muted"> ({t('common.you')})</span>}
                        </strong>
                        <span className="wl-chips">
                          {row.urgent > 0 && <span className="chip chip-priority-urgent">{t('workload.urgent', { n: row.urgent })}</span>}
                          {row.toReview > 0 && (
                            <span className="chip chip-status-review">
                              {t('workload.col.review')}: {row.toReview}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="wl-count">
                      <span className="wl-number">{row.open}</span>
                      <span className="muted small">{t('workload.col.open')}</span>
                    </div>
                    <div
                      className="wl-bar"
                      role="img"
                      aria-label={t('workload.spread', { open: row.open, overdue: row.overdue, week: row.dueWeek, later: row.later })}
                      style={{ width: `${Math.max(8, (row.open / widest) * 100)}%` }}
                    >
                      {row.overdue > 0 && (
                        <span className="wl-seg wl-seg-overdue" style={{ flexGrow: row.overdue }}>
                          {row.overdue}
                        </span>
                      )}
                      {row.dueWeek > 0 && (
                        <span className="wl-seg wl-seg-week" style={{ flexGrow: row.dueWeek }}>
                          {row.dueWeek}
                        </span>
                      )}
                      {row.later > 0 && (
                        <span className="wl-seg wl-seg-later" style={{ flexGrow: row.later }}>
                          {row.later}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm wl-toggle"
                      aria-expanded={isOpen}
                      aria-controls={listId}
                      onClick={() => setOpenRow(isOpen ? null : key)}
                      disabled={row.open === 0}
                      aria-label={isOpen ? t('workload.hide', { name }) : t('workload.show', { n: row.open, name })}
                    >
                      {isOpen ? t('common.close') : t('workload.showBtn')}
                    </button>
                  </div>
                  {isOpen && (
                    <ul id={listId} className="wl-tasks">
                      {row.tasks.map((task) => {
                        const project = projectById.get(task.project_id)
                        const late = daysBetween(task.deadline, today)
                        return (
                          <li key={task.id}>
                            <button type="button" className="link-btn" onClick={() => setEditing(task)} aria-label={t('tasks.openTask', { title: task.title })}>
                              {task.title}
                            </button>
                            <span className="wl-task-meta">
                              {project && <ProjectName name={project.name} color={project.color} />}
                              <StatusChip status={task.status} />
                              <PriorityChip priority={task.priority} />
                              <span>{formatDate(task.deadline, locale)}</span>
                              {late > 0 && <span className="chip chip-overdue">{t('tasks.overdue', { n: late })}</span>}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {editing && (
        <TaskForm
          task={editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onChanged={load}
          onSaved={() => {
            setEditing(null)
            load()
          }}
          onDeleted={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}
