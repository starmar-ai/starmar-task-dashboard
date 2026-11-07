import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { daysBetween, formatDate, todayIn } from '../lib/dates'
import { canEditTask } from '../lib/permissions'
import {
  PERIODS,
  addDays,
  byDeadlineThenPriority,
  focusToday,
  inBucket,
  isDueInRange,
  isOverdue,
  loadByProject,
  needsAttention,
  periodRange,
  type Bucket,
  type PeriodKey,
} from '../lib/dashboard'
import type { Profile, Project, Task, TaskStatus } from '../lib/types'
import { PriorityChip, ProjectName, StatusChip } from '../components/Chips'
import { EmptyState, ErrorState, LoadingState } from '../components/States'
import { TaskForm } from './TaskForm'

const ATTENTION_PREVIEW = 6
const BUCKETS: Bucket[] = ['all', 'overdue', 'due']

function isPeriod(v: string | null): v is PeriodKey {
  return !!v && (PERIODS as string[]).includes(v)
}

/** Deadline text plus a chip that says how close it is. Shared by every list on the page. */
function DeadlineInfo({ task, today }: { task: Task; today: string }) {
  const { t, locale } = useI18n()
  const late = daysBetween(task.deadline, today)
  return (
    <span className="dash-deadline">
      <span>{formatDate(task.deadline, locale)}</span>
      {task.status !== 'done' && late > 0 && <span className="chip chip-overdue">{t('tasks.overdue', { n: late })}</span>}
      {task.status !== 'done' && late === 0 && <span className="chip chip-today">{t('tasks.dueToday')}</span>}
      {task.status !== 'done' && late === -1 && <span className="chip">{t('dash.dueTomorrow')}</span>}
    </span>
  )
}

interface RowProps {
  task: Task
  today: string
  project: Project | undefined
  assignee: Profile | undefined
  me: Profile | null
  onOpen: (task: Task) => void
  showAssignee?: boolean
}

function TaskLine({ task, today, project, assignee, me, onOpen, showAssignee = true }: RowProps) {
  const { t } = useI18n()
  return (
    <li className="dash-row">
      <button type="button" className="link-btn dash-row-title" onClick={() => onOpen(task)} aria-label={t('tasks.openTask', { title: task.title })}>
        {task.title}
      </button>
      <div className="dash-row-meta">
        <DeadlineInfo task={task} today={today} />
        <StatusChip status={task.status} />
        <PriorityChip priority={task.priority} />
        {project && <ProjectName name={project.name} color={project.color} />}
        {showAssignee && (
          <span className="muted small">
            {assignee ? (assignee.id === me?.id ? `${assignee.full_name} (${t('common.you')})` : assignee.full_name) : t('common.none')}
          </span>
        )}
      </div>
    </li>
  )
}

export function DashboardPage() {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const [params, setParams] = useSearchParams()

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showAllAttention, setShowAllAttention] = useState(false)
  const [bucket, setBucket] = useState<Bucket>('all')
  const [chartProject, setChartProject] = useState<string | null>(null)
  const detailsRef = useRef<HTMLElement>(null)

  const timezone = profile?.timezone ?? 'Asia/Jakarta'
  const today = todayIn(timezone)

  const periodParam = params.get('period')
  const period: PeriodKey = isPeriod(periodParam) ? periodParam : '7d'
  const projectFilter = params.get('project') ?? ''
  const customFrom = params.get('from') ?? ''
  const customTo = params.get('to') ?? ''
  const range = periodRange(period, today, { from: customFrom, to: customTo })

  function updateParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  function choosePeriod(p: PeriodKey) {
    if (p === 'custom') {
      // Start the custom range on the range already on screen, so switching is not a blank form.
      const current = range ?? { from: today, to: addDays(today, 6) }
      updateParams({ period: p, from: customFrom || current.from, to: customTo || current.to })
    } else updateParams({ period: p, from: null, to: null })
  }

  // Done tasks never count on this page, so they are not fetched.
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

  const projectById = useMemo(() => new Map(lookups.projects.map((p) => [p.id, p])), [lookups.projects])
  const personById = useMemo(() => new Map(lookups.people.map((p) => [p.id, p])), [lookups.people])

  // Archived projects stay out unless the user picks one in the filter.
  const scoped = useMemo(
    () =>
      tasks.filter((task) => {
        if (projectFilter) return task.project_id === projectFilter
        const p = projectById.get(task.project_id)
        return !!p && !p.archived
      }),
    [tasks, projectFilter, projectById],
  )

  const overdueCount = scoped.filter((task) => isOverdue(task, today)).length
  const dueCount = range ? scoped.filter((task) => isDueInRange(task, range, today)).length : 0
  const total = overdueCount + dueCount

  const attention = useMemo(() => needsAttention(scoped, today), [scoped, today])
  const focus = useMemo(() => (profile ? focusToday(scoped, profile.id, today) : []), [scoped, profile, today])
  const chart = useMemo(() => (range ? loadByProject(scoped, range, today) : []), [scoped, range, today])
  const chartMax = Math.max(1, ...chart.map((r) => r.overdue + r.due))

  const detailProject = projectFilter ? null : chartProject
  const details = range
    ? scoped
        .filter((task) => inBucket(task, bucket, range, today))
        .filter((task) => !detailProject || task.project_id === detailProject)
        .sort(byDeadlineThenPriority)
    : []

  function showDetails(next: Bucket, projectId: string | null = null) {
    setBucket(next)
    setChartProject(projectId)
    requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ block: 'start' }))
  }

  async function finish(task: Task, status: TaskStatus) {
    setActionError(null)
    setBusyId(task.id)
    const { error } = await supabase.from('tasks').update({ status }).eq('id', task.id)
    setBusyId(null)
    if (error) return setActionError(errorMessage(t, error))
    setTasks((prev) => (status === 'done' ? prev.filter((x) => x.id !== task.id) : prev.map((x) => (x.id === task.id ? { ...x, status } : x))))
  }

  const rowProps = (task: Task) => ({
    task,
    today,
    project: projectById.get(task.project_id),
    assignee: task.assignee_id ? personById.get(task.assignee_id) : undefined,
    me: profile,
    onOpen: setEditing,
  })

  const rangeText = !range
    ? ''
    : range.from === range.to
      ? range.from === today
        ? t('dash.rangeToday', { date: formatDate(today, locale) })
        : formatDate(range.from, locale)
      : t('dash.rangeSpan', { from: formatDate(range.from, locale), to: formatDate(range.to, locale) })

  const noProjects = !lookups.loading && lookups.projects.length === 0
  const isAdmin = profile?.role === 'admin'
  const filteredProject = projectFilter ? projectById.get(projectFilter) : undefined
  const detailProjectInfo = detailProject ? projectById.get(detailProject) : undefined

  return (
    <div className="page dash">
      <header className="page-head">
        <div>
          <h1>{t('dash.title')}</h1>
          {range && <p className="muted">{rangeText}</p>}
        </div>
        <div className="filters dash-filters">
          <div className="field field-inline">
            <label htmlFor="dash-project">{t('tasks.filterProject')}</label>
            <select
              id="dash-project"
              value={projectFilter}
              onChange={(e) => {
                setChartProject(null)
                updateParams({ project: e.target.value || null })
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
          <fieldset className="segmented">
            <legend className="sr-only">{t('dash.period')}</legend>
            {PERIODS.map((p) => (
              <label key={p} className={period === p ? 'is-on' : ''}>
                <input type="radio" name="dash-period" checked={period === p} onChange={() => choosePeriod(p)} />
                {t(`dash.period.${p}`)}
              </label>
            ))}
          </fieldset>
        </div>
      </header>

      {period === 'custom' && (
        <div className="dash-custom">
          <div className="field">
            <label htmlFor="dash-from">{t('dash.from')}</label>
            <input id="dash-from" type="date" value={customFrom} onChange={(e) => updateParams({ from: e.target.value || null })} />
          </div>
          <div className="field">
            <label htmlFor="dash-to">{t('dash.to')}</label>
            <input id="dash-to" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => updateParams({ to: e.target.value || null })} />
          </div>
          {!range && (
            <p className="form-error" role="alert">
              {t('dash.customInvalid')}
            </p>
          )}
        </div>
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
          message={t('dash.loadError')}
          detail={loadError ?? lookups.error ?? undefined}
          onRetry={() => {
            load()
            lookups.reload()
          }}
        />
      ) : noProjects ? (
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
        <>
          <section className="dash-hero" aria-labelledby="dash-total">
            <div className="dash-total">
              <p id="dash-total">
                <span className="dash-number">{range ? total : '–'}</span>
                <span className="dash-number-label">{t('dash.mustFinish')}</span>
              </p>
              {filteredProject && <ProjectName name={filteredProject.name} color={filteredProject.color} />}
              {range && total === 0 && <p className="muted">{t('dash.allClear')}</p>}
            </div>
            <div className="dash-split">
              <button
                type="button"
                className={`dash-stat dash-stat-overdue ${overdueCount === 0 ? 'is-zero' : ''}`}
                onClick={() => showDetails('overdue')}
                aria-label={t('dash.seeOverdue', { n: overdueCount })}
              >
                <span className="dash-stat-number">{overdueCount}</span>
                <span className="dash-stat-text">
                  <strong>{t('dash.overdue')}</strong>
                  <span>{t('dash.overdueHint')}</span>
                </span>
              </button>
              <button
                type="button"
                className="dash-stat dash-stat-due"
                onClick={() => showDetails('due')}
                disabled={!range}
                aria-label={t('dash.seeDue', { n: dueCount })}
              >
                <span className="dash-stat-number">{range ? dueCount : '–'}</span>
                <span className="dash-stat-text">
                  <strong>{t('dash.due')}</strong>
                  <span>{t('dash.dueHint')}</span>
                </span>
              </button>
            </div>
            <p className="muted small dash-note">{t('dash.overdueNote')}</p>
          </section>

          <div className="dash-columns">
            <section className="card dash-focus" aria-labelledby="dash-focus-title">
              <div>
                <h2 id="dash-focus-title">{t('dash.focus.title')}</h2>
                <p className="muted small">{t('dash.focus.hint')}</p>
              </div>
              {focus.length === 0 ? (
                <p className="dash-empty">{t('dash.focus.empty')}</p>
              ) : (
                <ol className="dash-focus-list">
                  {focus.map((task, i) => {
                    const needsReview = !!task.reviewer_id && task.reviewer_id !== profile?.id
                    const editable = canEditTask(profile, task)
                    const project = projectById.get(task.project_id)
                    return (
                      <li key={task.id} className="dash-focus-item">
                        <span className="dash-focus-rank" aria-hidden="true">
                          {i + 1}
                        </span>
                        <div className="dash-focus-body">
                          <button type="button" className="link-btn dash-row-title" onClick={() => setEditing(task)} aria-label={t('tasks.openTask', { title: task.title })}>
                            {task.title}
                          </button>
                          <div className="dash-row-meta">
                            <DeadlineInfo task={task} today={today} />
                            <PriorityChip priority={task.priority} />
                            {project && <ProjectName name={project.name} color={project.color} />}
                          </div>
                        </div>
                        {editable && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busyId === task.id}
                            onClick={() => finish(task, needsReview ? 'review' : 'done')}
                            aria-label={needsReview ? t('dash.sendReviewFor', { title: task.title }) : t('dash.markDoneFor', { title: task.title })}
                          >
                            {needsReview ? t('dash.sendReview') : t('dash.markDone')}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>

            <section className="card dash-attention" aria-labelledby="dash-attention-title">
              <div>
                <h2 id="dash-attention-title">
                  {t('dash.attention.title')} <span className="dash-count">{attention.length}</span>
                </h2>
                <p className="muted small">{t('dash.attention.hint')}</p>
              </div>
              {attention.length === 0 ? (
                <p className="dash-empty">{t('dash.attention.empty')}</p>
              ) : (
                <>
                  <ul className="dash-list">
                    {(showAllAttention ? attention : attention.slice(0, ATTENTION_PREVIEW)).map((task) => (
                      <TaskLine key={task.id} {...rowProps(task)} />
                    ))}
                  </ul>
                  {attention.length > ATTENTION_PREVIEW && (
                    <button type="button" className="btn btn-ghost btn-sm dash-more" onClick={() => setShowAllAttention((v) => !v)}>
                      {showAllAttention ? t('dash.showLess') : t('dash.showAll', { n: attention.length })}
                    </button>
                  )}
                </>
              )}
            </section>
          </div>

          {!projectFilter && range && total > 0 && (
            <section className="card" aria-labelledby="dash-chart-title">
              <div>
                <h2 id="dash-chart-title">{t('dash.chart.title')}</h2>
                <p className="muted small">{t('dash.chart.hint')}</p>
              </div>
              {chart.length === 0 ? (
                <p className="dash-empty">{t('dash.chart.empty')}</p>
              ) : (
                <>
                  <p className="dash-legend small">
                    <span>
                      <i className="dash-key dash-key-overdue" aria-hidden="true" />
                      {t('dash.list.overdue')}
                    </span>
                    <span>
                      <i className="dash-key dash-key-due" aria-hidden="true" />
                      {t('dash.list.due')}
                    </span>
                  </p>
                  <ul className="dash-bars">
                    {chart.map((row) => {
                      const p = projectById.get(row.projectId)
                      if (!p) return null
                      const selected = chartProject === row.projectId
                      return (
                        <li key={row.projectId}>
                          <button
                            type="button"
                            className={`dash-bar-row ${selected ? 'is-on' : ''}`}
                            aria-pressed={selected}
                            aria-label={t('dash.chart.row', { name: p.name, overdue: row.overdue, due: row.due })}
                            onClick={() => showDetails('all', row.projectId)}
                          >
                            <ProjectName name={p.name} color={p.color} />
                            <span className="dash-bar-track">
                              {row.overdue > 0 && <span className="dash-bar dash-bar-overdue" style={{ width: `${(row.overdue / chartMax) * 100}%` }} />}
                              {row.due > 0 && <span className="dash-bar dash-bar-due" style={{ width: `${(row.due / chartMax) * 100}%` }} />}
                            </span>
                            <span className="dash-bar-nums">
                              <strong>{row.overdue + row.due}</strong>
                              {row.overdue > 0 && <span className="muted"> · {row.overdue} {t('dash.overdue')}</span>}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </section>
          )}

          {range && total > 0 && (
            <section className="card dash-details" ref={detailsRef} aria-labelledby="dash-details-title">
              <div className="dash-details-head">
                <h2 id="dash-details-title">
                  {t('dash.list.title')} <span className="dash-count">{details.length}</span>
                </h2>
                <fieldset className="segmented segmented-sm">
                  <legend className="sr-only">{t('dash.list.show')}</legend>
                  {BUCKETS.map((b) => (
                    <label key={b} className={bucket === b ? 'is-on' : ''}>
                      <input type="radio" name="dash-bucket" checked={bucket === b} onChange={() => setBucket(b)} />
                      {t(`dash.list.${b}`)}
                    </label>
                  ))}
                </fieldset>
                {detailProjectInfo && (
                  <button type="button" className="chip dash-clear" onClick={() => setChartProject(null)} aria-label={t('dash.list.clearProject', { name: detailProjectInfo.name })}>
                    {t('dash.list.onlyProject', { name: detailProjectInfo.name })}
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
              {details.length === 0 ? (
                <p className="dash-empty">{t('dash.list.empty')}</p>
              ) : (
                <ul className="dash-list">
                  {details.map((task) => (
                    <TaskLine key={task.id} {...rowProps(task)} />
                  ))}
                </ul>
              )}
              {(detailProject || projectFilter) && (
                <Link to={`/tasks?project=${detailProject || projectFilter}`} className="btn btn-secondary btn-sm dash-open-tasks">
                  {t('dash.openInTasks')}
                </Link>
              )}
            </section>
          )}
        </>
      )}

      {editing && (
        <TaskForm
          task={editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setTasks((prev) => (saved.status === 'done' ? prev.filter((x) => x.id !== saved.id) : prev.map((x) => (x.id === saved.id ? saved : x))))
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
