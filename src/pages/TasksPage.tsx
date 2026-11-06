import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { daysBetween, formatDate, todayIn } from '../lib/dates'
import { canEditTask } from '../lib/permissions'
import type { Task, TaskStatus } from '../lib/types'
import { LabelTag, PriorityChip, ProjectName, StatusChip } from '../components/Chips'
import { EmptyState, ErrorState, LoadingState } from '../components/States'
import { TaskForm } from './TaskForm'

const EDITABLE_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done']

export function TasksPage() {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const [params, setParams] = useSearchParams()
  const projectFilter = params.get('project') ?? ''
  const [showDone, setShowDone] = useState(false)

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)

  const [title, setTitle] = useState('')
  const [quickProject, setQuickProject] = useState('')
  const [deadline, setDeadline] = useState('')
  const [adding, setAdding] = useState(false)
  const [quickError, setQuickError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const timezone = profile?.timezone ?? 'Asia/Jakarta'
  const today = todayIn(timezone)

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase.from('tasks').select('*, task_labels(label_id)').order('deadline').order('created_at')
    if (error) setLoadError(error.message)
    else setTasks(data as Task[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const activeProjects = useMemo(() => lookups.projects.filter((p) => !p.archived), [lookups.projects])
  const projectById = useMemo(() => new Map(lookups.projects.map((p) => [p.id, p])), [lookups.projects])
  const personById = useMemo(() => new Map(lookups.people.map((p) => [p.id, p])), [lookups.people])
  const labelById = useMemo(() => new Map(lookups.labels.map((l) => [l.id, l])), [lookups.labels])

  useEffect(() => {
    if (projectFilter) setQuickProject(projectFilter)
    else if (!quickProject && activeProjects[0]) setQuickProject(activeProjects[0].id)
  }, [projectFilter, activeProjects, quickProject])

  const inScope = tasks.filter((task) => {
    if (projectFilter) return task.project_id === projectFilter
    return !projectById.get(task.project_id)?.archived
  })
  const visible = inScope.filter((task) => showDone || task.status !== 'done')

  async function onQuickAdd(e: FormEvent) {
    e.preventDefault()
    setQuickError(null)
    if (!title.trim() || !quickProject || !deadline) {
      setQuickError(t('taskForm.required'))
      return
    }
    setAdding(true)
    const { data, error } = await supabase
      .from('tasks')
      .insert({ title: title.trim(), project_id: quickProject, deadline })
      .select('*, task_labels(label_id)')
      .single()
    setAdding(false)
    if (error) return setQuickError(errorMessage(t, error))
    setTasks((prev) => [...prev, data as Task].sort((a, b) => a.deadline.localeCompare(b.deadline)))
    setTitle('')
    titleRef.current?.focus()
  }

  async function changeStatus(task: Task, status: TaskStatus) {
    setActionError(null)
    const previous = tasks
    setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, status } : x)))
    const { error } = await supabase.from('tasks').update({ status }).eq('id', task.id)
    if (error) {
      setTasks(previous)
      setActionError(errorMessage(t, error))
    }
  }

  const noProjects = !lookups.loading && lookups.projects.length === 0
  const isAdmin = profile?.role === 'admin'

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('tasks.title')}</h1>
          {!loading && !loadError && <p className="muted">{t('tasks.count', { n: visible.length })}</p>}
        </div>
        <div className="filters">
          <div className="field field-inline">
            <label htmlFor="filter-project">{t('tasks.filterProject')}</label>
            <select
              id="filter-project"
              value={projectFilter}
              onChange={(e) => {
                const v = e.target.value
                setParams(v ? { project: v } : {})
              }}
            >
              <option value="">{t('tasks.allProjects')}</option>
              {lookups.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.archived ? ` (${t('projects.archived')})` : ''}
                </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            {t('tasks.showDone')}
          </label>
        </div>
      </header>

      {noProjects ? (
        <EmptyState
          action={
            isAdmin ? (
              <Link to="/projects?new=1" className="btn btn-primary">
                {t('tasks.goProjects')}
              </Link>
            ) : undefined
          }
        >
          {isAdmin ? t('tasks.emptyNoProject') : t('tasks.emptyNoProjectMember')}
        </EmptyState>
      ) : (
        <form className="quick-add" onSubmit={onQuickAdd} aria-label={t('tasks.add')}>
          <div className="field quick-title">
            <label htmlFor="quick-title">{t('tasks.quickTitle')}</label>
            <input
              id="quick-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tasks.quickPlaceholder')}
              maxLength={200}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="quick-project">{t('taskForm.project')}</label>
            <select id="quick-project" value={quickProject} onChange={(e) => setQuickProject(e.target.value)}>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="quick-deadline">{t('taskForm.deadline')}</label>
            <input id="quick-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={adding}>
            {adding ? t('tasks.adding') : t('tasks.add')}
          </button>
          {quickError && (
            <p className="form-error quick-error" role="alert">
              {quickError}
            </p>
          )}
        </form>
      )}

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {loading || lookups.loading ? (
        <LoadingState />
      ) : loadError || lookups.error ? (
        <ErrorState
          message={t('tasks.loadError')}
          detail={loadError ?? lookups.error ?? undefined}
          onRetry={() => {
            load()
            lookups.reload()
          }}
        />
      ) : noProjects ? null : visible.length === 0 ? (
        <EmptyState>{inScope.length > 0 ? t('tasks.emptyFiltered') : t('tasks.empty')}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table task-table">
            <thead>
              <tr>
                <th scope="col">{t('tasks.col.task')}</th>
                <th scope="col">{t('tasks.col.deadline')}</th>
                <th scope="col">{t('tasks.col.status')}</th>
                <th scope="col">{t('tasks.col.priority')}</th>
                <th scope="col">{t('tasks.col.project')}</th>
                <th scope="col">{t('tasks.col.assignee')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((task) => {
                const project = projectById.get(task.project_id)
                const assignee = task.assignee_id ? personById.get(task.assignee_id) : null
                const late = task.status !== 'done' ? daysBetween(task.deadline, today) : 0
                const editable = canEditTask(profile, task)
                return (
                  <tr key={task.id} className={late > 0 ? 'is-overdue' : ''}>
                    <td data-label={t('tasks.col.task')} className="cell-title">
                      <button type="button" className="link-btn" onClick={() => setEditing(task)} aria-label={t('tasks.openTask', { title: task.title })}>
                        {task.title}
                      </button>
                      {task.task_labels.length > 0 && (
                        <span className="label-row">
                          {task.task_labels.map(({ label_id }) => {
                            const l = labelById.get(label_id)
                            return l ? <LabelTag key={l.id} name={l.name} color={l.color} /> : null
                          })}
                        </span>
                      )}
                    </td>
                    <td data-label={t('tasks.col.deadline')} className="cell-deadline">
                      <span>{formatDate(task.deadline, locale)}</span>
                      {late > 0 && <span className="chip chip-overdue">{t('tasks.overdue', { n: late })}</span>}
                      {late === 0 && task.status !== 'done' && <span className="chip chip-today">{t('tasks.dueToday')}</span>}
                    </td>
                    <td data-label={t('tasks.col.status')}>
                      {editable && task.status !== 'blocked' ? (
                        <select
                          className={`chip-select chip-status-${task.status}`}
                          value={task.status}
                          aria-label={t('tasks.changeStatus', { title: task.title })}
                          onChange={(e) => changeStatus(task, e.target.value as TaskStatus)}
                        >
                          {EDITABLE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(`status.${s}`)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusChip status={task.status} />
                      )}
                    </td>
                    <td data-label={t('tasks.col.priority')}>
                      <PriorityChip priority={task.priority} />
                    </td>
                    <td data-label={t('tasks.col.project')}>{project && <ProjectName name={project.name} color={project.color} />}</td>
                    <td data-label={t('tasks.col.assignee')}>
                      {assignee ? (assignee.id === profile?.id ? `${assignee.full_name} (${t('common.you')})` : assignee.full_name) : <span className="muted">{t('common.none')}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TaskForm
          task={editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setTasks((prev) => prev.map((x) => (x.id === saved.id ? saved : x)).sort((a, b) => a.deadline.localeCompare(b.deadline)))
            setEditing(null)
          }}
          onDeleted={(id) => {
            setTasks((prev) => prev.filter((x) => x.id !== id))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
