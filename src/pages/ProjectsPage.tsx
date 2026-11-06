import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { formatDate } from '../lib/dates'
import type { ProjectOverview } from '../lib/types'
import { ProjectName, ProjectStatusChip, RiskChip } from '../components/Chips'
import { EmptyState, ErrorState, LoadingState } from '../components/States'
import { ProjectForm } from './ProjectForm'

export function ProjectsPage() {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const isAdmin = profile?.role === 'admin'
  const [params, setParams] = useSearchParams()

  const [rows, setRows] = useState<ProjectOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
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
  const visible = rows.filter((r) => showArchived || !r.archived)
  const archivedCount = rows.filter((r) => r.archived).length

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
          {archivedCount > 0 && (
            <label className="check">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              {t('projects.showArchived')} ({archivedCount})
            </label>
          )}
          {isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              {t('projects.new')}
            </button>
          )}
        </div>
      </header>

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('projects.loadError')} detail={loadError} onRetry={load} />
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
      ) : (
        <div className="table-wrap">
          <table className="data-table project-table">
            <thead>
              <tr>
                <th scope="col">{t('projects.col.project')}</th>
                <th scope="col">{t('projects.col.status')}</th>
                <th scope="col">{t('projects.col.progress')}</th>
                <th scope="col">{t('projects.col.overdue')}</th>
                <th scope="col">{t('projects.col.period')}</th>
                <th scope="col">{t('projects.col.pm')}</th>
                {isAdmin && (
                  <th scope="col">
                    <span className="sr-only">{t('common.edit')}</span>
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
                        {p.archived && <span className="chip">{t('projects.archived')}</span>}
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
                    <td data-label={t('projects.col.overdue')}>
                      {p.task_overdue > 0 ? <span className="chip chip-overdue">{t('projects.overdueCount', { n: p.task_overdue })}</span> : <span className="muted">0</span>}
                    </td>
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
