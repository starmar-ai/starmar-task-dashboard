import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { formatDate, todayIn } from '../lib/dates'
import { daysLeft, purgeExpired, purgeOne, TRASH_DAYS } from '../lib/trash'
import { emitTasksChanged } from '../lib/taskEvents'
import type { Task } from '../lib/types'
import { ProjectName, StatusChip } from '../components/Chips'
import { ConfirmDialog } from '../components/Modal'
import { EmptyState, ErrorState, LoadingState } from '../components/States'

export function TrashPage() {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const today = todayIn(profile?.timezone ?? 'Asia/Jakarta')
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [purging, setPurging] = useState<Task | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    await purgeExpired(today)
    const { data, error } = await supabase.rpc('list_trash')
    if (error) setLoadError(error.message)
    else setTasks(data as Task[])
    setLoading(false)
  }, [today])

  useEffect(() => {
    load()
  }, [load])

  const projectById = useMemo(() => new Map(lookups.projects.map((p) => [p.id, p])), [lookups.projects])

  async function restore(task: Task) {
    setActionError(null)
    setBusyId(task.id)
    const { error } = await supabase.rpc('restore_task', { p_task: task.id })
    setBusyId(null)
    if (error) return setActionError(errorMessage(t, error))
    setTasks((prev) => prev.filter((x) => x.id !== task.id))
    emitTasksChanged()
  }

  async function purge() {
    if (!purging) return
    const task = purging
    setBusyId(task.id)
    const { error } = await purgeOne(task.id)
    setBusyId(null)
    setPurging(null)
    if (error) return setActionError(errorMessage(t, error))
    setTasks((prev) => prev.filter((x) => x.id !== task.id))
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('trash.title')}</h1>
          <p className="muted">{t('trash.hint', { n: TRASH_DAYS })}</p>
        </div>
      </header>

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {loading || lookups.loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('trash.loadError')} detail={loadError} onRetry={load} />
      ) : tasks.length === 0 ? (
        <EmptyState>{t('trash.empty')}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('tasks.col.task')}</th>
                <th scope="col">{t('tasks.col.project')}</th>
                <th scope="col">{t('trash.col.deleted')}</th>
                <th scope="col">{t('trash.col.left')}</th>
                <th scope="col">
                  <span className="sr-only">{t('trash.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const project = projectById.get(task.project_id)
                const left = task.deleted_at ? daysLeft(task.deleted_at, today) : TRASH_DAYS
                return (
                  <tr key={task.id}>
                    <td data-label={t('tasks.col.task')} className="cell-title">
                      <span>{task.title}</span>
                      <span className="small">
                        <StatusChip status={task.status} />
                      </span>
                    </td>
                    <td data-label={t('tasks.col.project')}>{project ? <ProjectName name={project.name} color={project.color} /> : <span className="muted">{t('common.none')}</span>}</td>
                    <td data-label={t('trash.col.deleted')}>{task.deleted_at ? formatDate(task.deleted_at.slice(0, 10), locale) : ''}</td>
                    <td data-label={t('trash.col.left')}>{t('trash.daysLeft', { n: left })}</td>
                    <td className="cell-actions">
                      <span className="status-cell">
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === task.id} onClick={() => restore(task)} aria-label={t('trash.restoreFor', { title: task.title })}>
                          {t('trash.restore')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm btn-danger-text" disabled={busyId === task.id} onClick={() => setPurging(task)} aria-label={t('trash.purgeFor', { title: task.title })}>
                          {t('trash.purge')}
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {purging && (
        <ConfirmDialog
          title={t('trash.purgeTitle')}
          message={t('trash.purgeConfirm', { title: purging.title })}
          confirmLabel={t('trash.purge')}
          busy={busyId === purging.id}
          onConfirm={purge}
          onCancel={() => setPurging(null)}
        />
      )}
    </div>
  )
}
