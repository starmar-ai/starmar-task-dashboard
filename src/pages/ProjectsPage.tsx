import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { formatDate, todayIn } from '../lib/dates'
import type { ProjectOverview } from '../lib/types'
import { ProjectName, ProjectStatusChip, RiskChip } from '../components/Chips'
import { EmptyState, ErrorState, LoadingState } from '../components/States'
import { Gantt, type GanttRow } from '../components/Gantt'
import { ProjectForm } from './ProjectForm'

export function ProjectsPage() {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const isAdmin = profile?.role === 'admin'
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const tab = params.get('tab') === 'arsip' ? 'arsip' : 'aktif'
  const view = tab === 'aktif' && params.get('view') === 'timeline' ? 'timeline' : 'table'

  const [rows, setRows] = useState<ProjectOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ProjectOverview | 'new' | null>(params.get('new') === '1' ? 'new' : null)

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase.from('project_overview').select('*').order('name')
    if (error) setLoadError(error.message)
    else setRows(data as ProjectOverview[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const personById = useMemo(() => new Map(lookups.people.map((p) => [p.id, p])), [lookups.people])
  const archivedCount = rows.filter((r) => r.archived).length
  const visible = rows.filter((r) => (tab === 'arsip' ? r.archived : !r.archived))

  const today = todayIn(profile?.timezone ?? 'Asia/Jakarta')
  const timelineRows = useMemo<GanttRow[]>(
    () =>
      visible
        .filter((p) => p.first_date && p.last_deadline)
        .sort((a, b) => (a.first_date as string).localeCompare(b.first_date as string))
        .map((p) => {
          const pct = p.task_total ? p.task_done / p.task_total : 0
          const period = `${formatDate(p.first_date, locale)} – ${formatDate(p.last_deadline, locale)}`
          const progress = t('projects.progressLabel', { done: p.task_done, total: p.task_total })
          return {
            id: p.id,
            label: p.name,
            sub: p.at_risk ? `${t('projects.atRisk')}. ${progress}` : progress,
            flag: p.task_overdue > 0 ? t('projects.overdueCount', { n: p.task_overdue }) : undefined,
            color: p.color,
            glyph: p.at_risk ? '!' : undefined,
            barText: `${Math.round(pct * 100)}%`,
            progress: pct,
            start: p.first_date as string,
            end: p.last_deadline as string,
            title: `${p.name}. ${t(`pstatus.${p.status}`)}. ${period}. ${progress}`,
          }
        }),
    [visible, locale, t],
  )
  const withoutTasks = visible.length - timelineRows.length

  function setTab(next: 'aktif' | 'arsip') {
    setParams(
      (prev) => {
        const q = new URLSearchParams(prev)
        if (next === 'arsip') q.set('tab', next)
        else q.delete('tab')
        return q
      },
      { replace: true },
    )
  }

  async function restore(project: ProjectOverview) {
    setActionError(null)
    setRestoring(project.id)
    const { error } = await supabase.from('projects').update({ archived: false, status: 'aktif' }).eq('id', project.id)
    setRestoring(null)
    if (error) return setActionError(errorMessage(t, error))
    await load()
    lookups.reload()
  }

  function closeForm() {
    setEditing(null)
    if (params.get('new')) setParams({})
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('projects.title')}</h1>
        </div>
        <div className="filters">
          <fieldset className="segmented segmented-sm view-switch">
            <legend className="sr-only">{t('projects.tabs')}</legend>
            {(['aktif', 'arsip'] as const).map((v) => (
              <label key={v} className={tab === v ? 'is-on' : ''}>
                <input type="radio" name="project-tab" checked={tab === v} onChange={() => setTab(v)} />
                {v === 'arsip' ? `${t('projects.tab.archive')} (${archivedCount})` : t('projects.tab.active')}
              </label>
            ))}
          </fieldset>
          {tab === 'aktif' && (
          <fieldset className="segmented segmented-sm view-switch">
            <legend className="sr-only">{t('view.label')}</legend>
            {(['table', 'timeline'] as const).map((v) => (
              <label key={v} className={view === v ? 'is-on' : ''}>
                <input
                  type="radio"
                  name="project-view"
                  checked={view === v}
                  onChange={() =>
                    setParams(
                      (prev) => {
                        const next = new URLSearchParams(prev)
                        if (v === 'timeline') next.set('view', v)
                        else next.delete('view')
                        return next
                      },
                      { replace: true },
                    )
                  }
                />
                {t(`view.${v}`)}
              </label>
            ))}
          </fieldset>
          )}
          {isAdmin && tab === 'aktif' && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              {t('projects.new')}
            </button>
          )}
        </div>
      </header>

      {tab === 'arsip' && !loading && !loadError && <p className="muted small">{t('projects.archiveHint')}</p>}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('projects.loadError')} detail={loadError} onRetry={load} />
      ) : visible.length === 0 && tab === 'arsip' ? (
        <EmptyState>{t('projects.archiveEmpty')}</EmptyState>
      ) : visible.length === 0 && archivedCount > 0 ? (
        <EmptyState
          action={
            <button type="button" className="btn btn-secondary" onClick={() => setTab('arsip')}>
              {t('projects.openArchive')}
            </button>
          }
        >
          {t('projects.allArchived')}
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState
          action={
            isAdmin ? (
              <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
                {t('projects.new')}
              </button>
            ) : undefined
          }
        >
          {isAdmin ? t('projects.empty') : t('projects.emptyMember')}
        </EmptyState>
      ) : view === 'timeline' ? (
        timelineRows.length === 0 ? (
          <EmptyState>{t('timeline.empty')}</EmptyState>
        ) : (
          <>
            <p className="muted small">{t('timeline.hint')}</p>
            <Gantt rows={timelineRows} today={today} nameHeader={t('projects.col.project')} onOpen={(id) => navigate(`/tasks?project=${id}&view=gantt`)} />
            {withoutTasks > 0 && <p className="muted small">{t('timeline.noTasks', { n: withoutTasks })}</p>}
          </>
        )
      ) : (
        <div className="table-wrap">
          <table className="data-table project-table">
            <thead>
              <tr>
                <th scope="col">{t('projects.col.project')}</th>
                <th scope="col">{t('projects.col.status')}</th>
                <th scope="col">{t('projects.col.progress')}</th>
                {tab === 'aktif' && <th scope="col">{t('projects.col.overdue')}</th>}
                {tab === 'arsip' && <th scope="col">{t('projects.col.finished')}</th>}
                <th scope="col">{t('projects.col.period')}</th>
                <th scope="col">{t('projects.col.pm')}</th>
                {isAdmin && (
                  <th scope="col">
                    <span className="sr-only">{tab === 'arsip' ? t('projects.col.actions') : t('common.edit')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0
                const pm = p.pm_id ? personById.get(p.pm_id) : null
                return (
                  <tr key={p.id} className={p.at_risk ? 'is-overdue' : ''}>
                    <td data-label={t('projects.col.project')} className="cell-title">
                      <Link to={`/tasks?project=${p.id}`} className="link-btn" aria-label={t('projects.openTasks', { name: p.name })}>
                        <ProjectName name={p.name} color={p.color} />
                      </Link>
                      {p.client_label && <span className="muted small">{p.client_label}</span>}
                    </td>
                    <td data-label={t('projects.col.status')}>
                      <span className="chip-row">
                        <ProjectStatusChip status={p.status} />
                        {p.at_risk && <RiskChip />}
                      </span>
                    </td>
                    <td data-label={t('projects.col.progress')}>
                      <div className="progress">
                        <div
                          className="progress-bar"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={t('projects.progressLabel', { done: p.task_done, total: p.task_total })}
                        >
                          <span style={{ width: `${pct}%` }} />
                        </div>
                        <span className="small">{t('projects.progressLabel', { done: p.task_done, total: p.task_total })}</span>
                      </div>
                    </td>
                    {tab === 'aktif' && (
                      <td data-label={t('projects.col.overdue')}>
                        {p.task_overdue > 0 ? <span className="chip chip-overdue">{t('projects.overdueCount', { n: p.task_overdue })}</span> : <span className="muted">0</span>}
                      </td>
                    )}
                    {tab === 'arsip' && (
                      <td data-label={t('projects.col.finished')}>{p.finished_at ? formatDate(new Date(p.finished_at).toLocaleDateString('en-CA', { timeZone: profile?.timezone ?? 'Asia/Jakarta' }), locale) : <span className="muted">{t('common.none')}</span>}</td>
                    )}
                    <td data-label={t('projects.col.period')}>
                      {p.first_date && p.last_deadline ? (
                        `${formatDate(p.first_date, locale)} – ${formatDate(p.last_deadline, locale)}`
                      ) : (
                        <span className="muted">{t('projects.periodEmpty')}</span>
                      )}
                    </td>
                    <td data-label={t('projects.col.pm')}>{pm ? pm.full_name || pm.email : <span className="muted">{t('common.none')}</span>}</td>
                    {isAdmin && (
                      <td className="cell-actions">
                        {tab === 'arsip' && (
                          <button type="button" className="btn btn-secondary btn-sm" disabled={restoring === p.id} onClick={() => restore(p)} aria-label={t('projects.restoreAria', { name: p.name })}>
                            {restoring === p.id ? t('common.saving') : t('projects.restore')}
                          </button>
                        )}
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(p)} aria-label={t('projects.edit', { name: p.name })}>
                          {t('common.edit')}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProjectForm
          project={editing === 'new' ? null : editing}
          people={lookups.people}
          onClose={closeForm}
          onSaved={() => {
            closeForm()
            load()
            lookups.reload()
          }}
        />
      )}
    </div>
  )
}
