import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { planBulkStatus, runEach, type BulkResult } from '../lib/bulk'
import { canOpenProject } from '../lib/team'
import { emitTasksChanged } from '../lib/taskEvents'
import { PRIORITIES, TASK_STATUSES, type Priority, type Task, type TaskStatus } from '../lib/types'
import type { useLookups } from '../lib/useTeam'
import { ConfirmDialog } from './Modal'

type Pending =
  | { kind: 'done' }
  | { kind: 'move'; projectId: string }
  | { kind: 'delete' }

/** Action bar for the tasks ticked in the list. Each change follows the same rules as changing one task by hand. */
export function BulkBar({
  tasks,
  lookups,
  onClear,
  onChanged,
}: {
  tasks: Task[]
  lookups: ReturnType<typeof useLookups>
  onClear: () => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const n = tasks.length

  function report(result: BulkResult, skipReasons: string[] = []) {
    const lines: string[] = []
    if (result.done) lines.push(t('bulk.resultDone', { n: result.done }))
    if (skipReasons.length) lines.push(t('bulk.resultSkipped', { n: skipReasons.length, reasons: [...new Set(skipReasons)].join(', ') }))
    if (result.failed) lines.push(t('bulk.resultFailed', { n: result.failed, message: result.firstError ?? '' }))
    setMessage(lines.join(' '))
    emitTasksChanged()
    onChanged()
    // Only clear the selection when everything went through; otherwise the leftovers stay ticked for a retry.
    if (!result.failed && !skipReasons.length) onClear()
  }

  async function withBusy(work: () => Promise<void>) {
    setBusy(true)
    setMessage(null)
    await work()
    setBusy(false)
  }

  const applyStatus = (target: TaskStatus) =>
    withBusy(async () => {
      const steps = planBulkStatus(profile, tasks, target)
      const skipped = steps.flatMap((s) => (s.kind === 'skip' ? [t(`bulk.skip.${s.reason}`)] : []))
      const todo = steps.flatMap((s) => (s.kind === 'skip' ? [] : [s]))
      const result = await runEach(todo, async (step) => {
        const { error } =
          step.kind === 'approve'
            ? await supabase.rpc('review_task', { p_task: step.id, p_approve: true })
            : await supabase.from('tasks').update({ status: step.status }).eq('id', step.id)
        return error ? { message: errorMessage(t, error) } : null
      })
      report(result, skipped)
    })

  const applyPriority = (priority: Priority) =>
    withBusy(async () => {
      const result = await runEach(tasks, async (task) => {
        const { error } = await supabase.from('tasks').update({ priority }).eq('id', task.id)
        return error ? { message: errorMessage(t, error) } : null
      })
      report(result)
    })

  const applyAssignee = (value: string) =>
    withBusy(async () => {
      const assigneeId = value === '__none' ? null : value
      const person = lookups.people.find((p) => p.id === assigneeId)
      const skipped: string[] = []
      const todo = tasks.filter((task) => {
        if (assigneeId && person && !canOpenProject(person, lookups.projects.find((p) => p.id === task.project_id), lookups.members)) {
          skipped.push(t('bulk.skip.person'))
          return false
        }
        return true
      })
      const result = await runEach(todo, async (task) => {
        const { error } = await supabase.from('tasks').update({ assignee_id: assigneeId }).eq('id', task.id)
        return error ? { message: errorMessage(t, error) } : null
      })
      report(result, skipped)
    })

  const applyMove = (projectId: string) =>
    withBusy(async () => {
      const skipped = tasks.filter((task) => task.project_id === projectId).map(() => t('bulk.skip.sameProject'))
      const todo = tasks.filter((task) => task.project_id !== projectId)
      const result = await runEach(todo, async (task) => {
        const { error } = await supabase.from('tasks').update({ project_id: projectId }).eq('id', task.id)
        return error ? { message: errorMessage(t, error) } : null
      })
      report(result, skipped)
    })

  const applyDelete = () =>
    withBusy(async () => {
      const result = await runEach(tasks, async (task) => {
        const { error } = await supabase.rpc('trash_task', { p_task: task.id })
        return error ? { message: errorMessage(t, error) } : null
      })
      report(result)
    })

  /** Selects fire once per choice and snap back to their label. */
  function pick(e: React.ChangeEvent<HTMLSelectElement>, handler: (value: string) => void) {
    const value = e.target.value
    e.target.value = ''
    if (value) handler(value)
  }

  const activePeople = lookups.people.filter((p) => p.active !== false)
  const projects = lookups.projects.filter((p) => !p.archived)
  const targetProject = pending?.kind === 'move' ? lookups.projects.find((p) => p.id === pending.projectId) : undefined

  return (
    <div className="bulk-bar" role="region" aria-label={t('bulk.actions')}>
      <div className="bulk-top">
        <strong className="bulk-count">{t('bulk.selected', { n })}</strong>
        <button type="button" className="link-btn" onClick={onClear} disabled={busy}>
          {t('bulk.clear')}
        </button>
      </div>
      <div className="bulk-actions">
        <select aria-label={t('bulk.status')} defaultValue="" disabled={busy} onChange={(e) => pick(e, (v) => (v === 'done' ? setPending({ kind: 'done' }) : applyStatus(v as TaskStatus)))}>
          <option value="">{t('bulk.status')}</option>
          {TASK_STATUSES.filter((s) => s !== 'blocked').map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('bulk.priority')} defaultValue="" disabled={busy} onChange={(e) => pick(e, (v) => applyPriority(v as Priority))}>
          <option value="">{t('bulk.priority')}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`priority.${p}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('bulk.assignee')} defaultValue="" disabled={busy} onChange={(e) => pick(e, applyAssignee)}>
          <option value="">{t('bulk.assignee')}</option>
          <option value="__none">{t('bulk.noAssignee')}</option>
          {activePeople.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}
            </option>
          ))}
        </select>
        <select aria-label={t('bulk.project')} defaultValue="" disabled={busy} onChange={(e) => pick(e, (v) => setPending({ kind: 'move', projectId: v }))}>
          <option value="">{t('bulk.project')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => setPending({ kind: 'delete' })}>
          {t('bulk.delete')}
        </button>
      </div>
      {message && (
        <p className="small bulk-message" role="status">
          {message}
        </p>
      )}

      {pending?.kind === 'done' && (
        <ConfirmDialog
          tone="primary"
          title={t('bulk.doneTitle', { n })}
          message={t('bulk.doneBody')}
          confirmLabel={t('bulk.doneConfirm')}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null)
            applyStatus('done')
          }}
        />
      )}
      {pending?.kind === 'move' && targetProject && (
        <ConfirmDialog
          tone="primary"
          title={t('bulk.moveTitle', { n, project: targetProject.name })}
          message={t('bulk.moveBody')}
          confirmLabel={t('bulk.moveConfirm')}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null)
            applyMove(targetProject.id)
          }}
        />
      )}
      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title={t('bulk.deleteTitle', { n })}
          message={t('bulk.deleteBody')}
          confirmLabel={t('bulk.deleteConfirm')}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null)
            applyDelete()
          }}
        />
      )}
    </div>
  )
}
