import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { daysBetween, formatDate, todayIn } from '../lib/dates'
import { canReview, indexDependencies } from '../lib/taskFlow'
import type { Task, TaskDependency, TaskStatus } from '../lib/types'
import { LabelTag, PriorityChip, ProjectName, STATUS_GLYPH } from '../components/Chips'
import { EmptyState, ErrorState, LoadingState } from '../components/States'
import { TaskBoard } from '../components/TaskBoard'
import { Gantt, type GanttEdge, type GanttRow } from '../components/Gantt'
import { useDateChange } from '../components/TaskDateChange'
import { canEditTask } from '../lib/permissions'
import { ReviewButtons, useTaskMover } from '../components/TaskMover'
import { TaskStatusControl } from '../components/TaskStatusControl'
import { TaskForm } from './TaskForm'

type View = 'table' | 'board' | 'gantt'
const VIEWS: View[] = ['table', 'board', 'gantt']

export function TasksPage() {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const [params, setParams] = useSearchParams()
  const projectFilter = params.get('project') ?? ''
  const view: View = params.get('view') === 'board' ? 'board' : params.get('view') === 'gantt' ? 'gantt' : 'table'
  const [showDone, setShowDone] = useState(false)

  const [tasks, setTasks] = useState<Task[]>([])
  const [deps, setDeps] = useState<TaskDependency[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
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
    const [taskRes, depRes] = await Promise.all([
      supabase.from('tasks').select('*, task_labels(label_id)').order('deadline').order('created_at'),
      supabase.from('task_dependencies').select('task_id, depends_on_id'),
    ])
    const error = taskRes.error || depRes.error
    if (error) setLoadError(error.message)
    else {
      setTasks(taskRes.data as Task[])
      setDeps(depRes.data as TaskDependency[])
    }
    setLoading(false)
  }, [])

  const mover = useTaskMover(load, (taskId, status) => setTasks((prev) => prev.map((x) => (x.id === taskId ? { ...x, status } : x))))

  const dateChange = useDateChange(load)

  useEffect(() => {
    load()
  }, [load])

  const activeProjects = useMemo(() => lookups.projects.filter((p) => !p.archived), [lookups.projects])
  const projectById = useMemo(() => new Map(lookups.projects.map((p) => [p.id, p])), [lookups.projects])
  const personById = useMemo(() => new Map(lookups.people.map((p) => [p.id, p])), [lookups.people])
  const labelById = useMemo(() => new Map(lookups.labels.map((l) => [l.id, l])), [lookups.labels])
  const taskById = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks])
  const depIndex = useMemo(() => indexDependencies(deps), [deps])

  /** Titles of the unfinished tasks this one waits for. */
  function waitingTitles(task: Task): string[] {
    return (depIndex.waitsFor.get(task.id) ?? [])
      .map((id) => taskById.get(id))
      .filter((x): x is Task => !!x && x.status !== 'done')
      .map((x) => x.title)
  }

  function setParam(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: key === 'view' },
    )
  }

  useEffect(() => {
    if (projectFilter) setQuickProject(projectFilter)
    else if (!quickProject && activeProjects[0]) setQuickProject(activeProjects[0].id)
  }, [projectFilter, activeProjects, quickProject])

  const inScope = tasks.filter((task) => {
    if (projectFilter) return task.project_id === projectFilter
    return !projectById.get(task.project_id)?.archived
  })
  const visible = inScope.filter((task) => showDone || task.status !== 'done')
  const currentProject = projectFilter ? projectById.get(projectFilter) : undefined
  const shownCount = view === 'table' ? visible.length : inScope.length

  const ganttRows = useMemo<GanttRow[]>(() => {
    if (view !== 'gantt') return []
    return [...inScope]
      .sort((a, b) => (a.start_date ?? a.deadline).localeCompare(b.start_date ?? b.deadline) || a.deadline.localeCompare(b.deadline))
      .map((task) => {
        const waiting = task.status === 'blocked' ? waitingTitles(task) : []
        const late = task.status !== 'done' ? daysBetween(task.deadline, today) : 0
        const project = projectById.get(task.project_id)
        const assignee = task.assignee_id ? personById.get(task.assignee_id) : null
        const range = task.start_date ? `${formatDate(task.start_date, locale)} – ${formatDate(task.deadline, locale)}` : t('gantt.deadlineOnly', { date: formatDate(task.deadline, locale) })
        return {
          id: task.id,
          label: task.title,
          sub: waiting.length ? t('tasks.waitingFor', { titles: waiting.join(', ') }) : projectFilter ? assignee?.full_name : project?.name,
          flag: late > 0 ? t('tasks.overdue', { n: late }) : undefined,
          tone: task.status,
          glyph: STATUS_GLYPH[task.status],
          start: task.start_date ?? task.deadline,
          end: task.deadline,
          noStart: !task.start_date,
          editable: canEditTask(profile, task),
          title: `${task.title}. ${t(`status.${task.status}`)}. ${range}`,
        }
      })
    // waitingTitles reads depIndex and taskById, which change together with tasks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, inScope, today, projectById, personById, locale, profile, depIndex, taskById, projectFilter])

  const ganttEdges = useMemo<GanttEdge[]>(() => {
    const ids = new Set(ganttRows.map((r) => r.id))
    return deps.filter((d) => ids.has(d.task_id) && ids.has(d.depends_on_id)).map((d) => ({ from: d.depends_on_id, to: d.task_id }))
  }, [ganttRows, deps])

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

  const noProjects = !lookups.loading && lookups.projects.length === 0
  const isAdmin = profile?.role === 'admin'

  return (
    <div className="page">
      <header className="page-head">
        <div>
          {currentProject ? (
            <>
              <p className="muted small page-kicker">{t('tasks.projectTasks')}</p>
              <h1 className="project-title">
                <ProjectName name={currentProject.name} color={currentProject.color} />
              </h1>
            </>
          ) : (
            <h1>{t('tasks.title')}</h1>
          )}
          {!loading && !loadError && <p className="muted">{t('tasks.count', { n: shownCount })}</p>}
        </div>
        <div className="filters">
          <fieldset className="segmented segmented-sm view-switch">
            <legend className="sr-only">{t('view.label')}</legend>
            {VIEWS.map((v) => (
              <label key={v} className={view === v ? 'is-on' : ''}>
                <input type="radio" name="task-view" checked={view === v} onChange={() => setParam('view', v === 'table' ? '' : v)} />
                {t(`view.${v}`)}
              </label>
            ))}
          </fieldset>
          <div className="field field-inline">
            <label htmlFor="filter-project">{t('tasks.filterProject')}</label>
            <select id="filter-project" value={projectFilter} onChange={(e) => setParam('project', e.target.value)}>
              <option value="">{t('tasks.allProjects')}</option>
              {lookups.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.archived ? ` (${t('projects.archived')})` : ''}
                </option>
              ))}
            </select>
          </div>
          {view === 'table' && (
            <label className="check">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              {t('tasks.showDone')}
            </label>
          )}
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

      {mover.error && (
        <p className="form-error" role="alert">
          {mover.error}
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
      ) : noProjects ? null : inScope.length === 0 ? (
        <EmptyState>{t('tasks.empty')}</EmptyState>
      ) : view === 'gantt' ? (
        <Gantt
          rows={ganttRows}
          edges={ganttEdges}
          today={today}
          nameHeader={t('tasks.col.task')}
          onOpen={(id) => setEditing(taskById.get(id) ?? null)}
          onChange={(id, next) => {
            const task = taskById.get(id)
            if (!task) return
            const linked = depIndex.waitsFor.has(id) || depIndex.waitedBy.has(id)
            dateChange.request(task, next, linked)
          }}
        />
      ) : view === 'board' ? (
        <TaskBoard
          tasks={inScope}
          today={today}
          me={profile}
          showProject={!projectFilter}
          projectById={projectById}
          personById={personById}
          waitingTitles={waitingTitles}
          mover={mover}
          onOpen={setEditing}
        />
      ) : visible.length === 0 ? (
        <EmptyState>{t('tasks.emptyFiltered')}</EmptyState>
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
                const waiting = task.status === 'blocked' ? waitingTitles(task) : []
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
                      {task.status === 'blocked' && <span className="small row-note">{t('tasks.waitingFor', { titles: waiting.join(', ') || '?' })}</span>}
                      {task.review_note && task.status === 'in_progress' && (
                        <button type="button" className="chip chip-note" onClick={() => setEditing(task)}>
                          <span aria-hidden="true" className="chip-glyph">
                            !
                          </span>
                          {t('tasks.reviewNoteFlag')}
                        </button>
                      )}
                    </td>
                    <td data-label={t('tasks.col.deadline')} className="cell-deadline">
                      <span>{formatDate(task.deadline, locale)}</span>
                      {late > 0 && <span className="chip chip-overdue">{t('tasks.overdue', { n: late })}</span>}
                      {late === 0 && task.status !== 'done' && <span className="chip chip-today">{t('tasks.dueToday')}</span>}
                    </td>
                    <td data-label={t('tasks.col.status')}>
                      <span className="status-cell">
                        <TaskStatusControl task={task} me={profile} busy={mover.busyId === task.id} onMove={(st: TaskStatus) => mover.move(task, st)} />
                        {task.status === 'review' && canReview(profile, task) && (
                          <ReviewButtons task={task} busy={mover.busyId === task.id} onApprove={() => mover.approve(task)} onReject={() => mover.startReject(task)} />
                        )}
                      </span>
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
      {mover.dialog}
      {dateChange.dialog}
    </div>
  )
}
