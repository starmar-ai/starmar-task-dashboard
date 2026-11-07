import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { daysBetween, formatDate, todayIn } from '../lib/dates'
import { groupByDate, monthGrid, monthStart, shiftMonth } from '../lib/calendar'
import { TASK_STATUSES, type Task, type TaskStatus } from '../lib/types'
import { ProjectName, StatusChip, STATUS_GLYPH } from '../components/Chips'
import { EmptyState, ErrorState, LoadingState } from '../components/States'
import { TaskForm } from './TaskForm'

const MAX_IN_CELL = 3

export function CalendarPage() {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const [params, setParams] = useSearchParams()
  const timezone = profile?.timezone ?? 'Asia/Jakarta'
  const today = todayIn(timezone)

  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? `${params.get('month')}-01` : monthStart(today)
  const projectFilter = params.get('project') ?? ''
  const assigneeFilter = params.get('assignee') ?? ''
  const statusFilter = (params.get('status') ?? '') as TaskStatus | ''

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [selected, setSelected] = useState<string>(today)
  const [showDone, setShowDone] = useState(true)

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

  function setParam(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  function goMonth(iso: string) {
    setParam('month', iso === monthStart(today) ? '' : iso.slice(0, 7))
    setSelected(iso === monthStart(today) ? today : iso)
  }

  const projectById = useMemo(() => new Map(lookups.projects.map((p) => [p.id, p])), [lookups.projects])
  const personById = useMemo(() => new Map(lookups.people.map((p) => [p.id, p])), [lookups.people])

  const days = useMemo(() => monthGrid(month), [month])
  const visible = useMemo(
    () =>
      tasks.filter((task) => {
        if (projectFilter ? task.project_id !== projectFilter : projectById.get(task.project_id)?.archived) return false
        if (assigneeFilter && task.assignee_id !== assigneeFilter) return false
        if (statusFilter && task.status !== statusFilter) return false
        if (!showDone && !statusFilter && task.status === 'done') return false
        return true
      }),
    [tasks, projectFilter, assigneeFilter, statusFilter, showDone, projectById],
  )
  const byDay = useMemo(() => groupByDate(visible, (x) => x.deadline), [visible])
  const inMonth = visible.filter((x) => x.deadline.slice(0, 7) === month.slice(0, 7))
  const overdueInMonth = inMonth.filter((x) => x.status !== 'done' && x.deadline < today).length

  const monthLabel = new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}T00:00:00Z`),
  )
  const weekdayNames = days.slice(0, 7).map((d) =>
    new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)),
  )

  const selectedTasks = byDay.get(selected) ?? []
  const hasFilter = !!(projectFilter || assigneeFilter || statusFilter)

  function chipFor(task: Task, compact: boolean) {
    const project = projectById.get(task.project_id)
    const late = task.status !== 'done' && task.deadline < today
    return (
      <button
        key={task.id}
        type="button"
        className={`cal-task ${late ? 'is-late' : ''} ${task.status === 'done' ? 'is-done' : ''}`}
        style={{ background: project?.color ?? 'var(--surface)' }}
        title={`${task.title} · ${project?.name ?? ''} · ${t(`status.${task.status}`)}`}
        onClick={(e) => {
          e.stopPropagation()
          setEditing(task)
        }}
      >
        <span aria-hidden="true" className="cal-task-glyph">
          {late ? '!' : STATUS_GLYPH[task.status]}
        </span>
        <span className="cal-task-title">{task.title}</span>
        {!compact && <span className="sr-only">{`, ${project?.name ?? ''}, ${t(`status.${task.status}`)}${late ? `, ${t('cal.late')}` : ''}`}</span>}
      </button>
    )
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('cal.title')}</h1>
          {!loading && !loadError && (
            <p className="muted">
              {t('cal.monthCount', { n: inMonth.length })}
              {overdueInMonth > 0 && <> · <strong>{t('cal.overdueCount', { n: overdueInMonth })}</strong></>}
            </p>
          )}
        </div>
        <div className="filters">
          <div className="field field-inline">
            <label htmlFor="cal-project">{t('tasks.filterProject')}</label>
            <select id="cal-project" value={projectFilter} onChange={(e) => setParam('project', e.target.value)}>
              <option value="">{t('tasks.allProjects')}</option>
              {lookups.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.archived ? ` (${t('projects.archived')})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-inline">
            <label htmlFor="cal-assignee">{t('tasks.col.assignee')}</label>
            <select id="cal-assignee" value={assigneeFilter} onChange={(e) => setParam('assignee', e.target.value)}>
              <option value="">{t('cal.everyone')}</option>
              {lookups.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-inline">
            <label htmlFor="cal-status">{t('tasks.col.status')}</label>
            <select id="cal-status" value={statusFilter} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">{t('cal.allStatuses')}</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          {!statusFilter && (
            <label className="check">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              {t('tasks.showDone')}
            </label>
          )}
        </div>
      </header>

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : (
        <>
          <div className="cal-toolbar">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => goMonth(shiftMonth(month, -1))} aria-label={t('cal.prev')}>
              ‹
            </button>
            <h2 className="cal-month">{monthLabel}</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => goMonth(shiftMonth(month, 1))} aria-label={t('cal.next')}>
              ›
            </button>
            {month !== monthStart(today) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => goMonth(monthStart(today))}>
                {t('cal.thisMonth')}
              </button>
            )}
          </div>

          <div className="cal-grid" role="grid" aria-label={monthLabel}>
            <div className="cal-row cal-head" role="row">
              {weekdayNames.map((w) => (
                <div key={w} role="columnheader" className="cal-weekday">
                  {w}
                </div>
              ))}
            </div>
            {Array.from({ length: days.length / 7 }, (_, w) => (
              <div className="cal-row" role="row" key={w}>
                {days.slice(w * 7, w * 7 + 7).map((d) => {
                  const list = byDay.get(d) ?? []
                  const outside = d.slice(0, 7) !== month.slice(0, 7)
                  const isToday = d === today
                  const late = list.some((x) => x.status !== 'done' && x.deadline < today)
                  return (
                    <div
                      key={d}
                      role="gridcell"
                      aria-selected={d === selected}
                      className={`cal-day ${outside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${d === selected ? 'is-selected' : ''}`}
                      onClick={() => setSelected(d)}
                    >
                      <button
                        type="button"
                        className="cal-date"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelected(d)
                        }}
                        aria-label={`${formatDate(d, locale)}${isToday ? `, ${t('gantt.today')}` : ''}, ${t('cal.dayCount', { n: list.length })}`}
                      >
                        {Number(d.slice(8))}
                      </button>
                      {isToday && <span className="cal-today-tag">{t('gantt.today')}</span>}
                      <div className="cal-day-tasks">
                        {list.slice(0, MAX_IN_CELL).map((task) => chipFor(task, true))}
                        {list.length > MAX_IN_CELL && <span className="cal-more">{t('cal.more', { n: list.length - MAX_IN_CELL })}</span>}
                      </div>
                      {list.length > 0 && (
                        <span className={`cal-dots ${late ? 'is-late' : ''}`} aria-hidden="true">
                          {list.length}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <section className="card cal-agenda" aria-live="polite">
            <h2 className="cal-agenda-title">
              {formatDate(selected, locale)}
              {selected === today && <span className="chip chip-today">{t('gantt.today')}</span>}
            </h2>
            {selectedTasks.length === 0 ? (
              <EmptyState>{hasFilter ? t('cal.emptyFiltered') : t('cal.emptyDay')}</EmptyState>
            ) : (
              <ul className="cal-agenda-list">
                {selectedTasks.map((task) => {
                  const project = projectById.get(task.project_id)
                  const assignee = task.assignee_id ? personById.get(task.assignee_id) : null
                  const late = task.status !== 'done' ? daysBetween(task.deadline, today) : 0
                  return (
                    <li key={task.id}>
                      <button type="button" className="cal-agenda-item" onClick={() => setEditing(task)}>
                        <span className="cal-agenda-main">
                          <strong>{task.title}</strong>
                          <span className="small muted">
                            {project && <ProjectName name={project.name} color={project.color} />}
                            {assignee && <> · {assignee.full_name || assignee.email}</>}
                          </span>
                        </span>
                        <span className="cal-agenda-side">
                          {late > 0 && <span className="chip chip-overdue">{t('tasks.overdue', { n: late })}</span>}
                          <StatusChip status={task.status} />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
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
