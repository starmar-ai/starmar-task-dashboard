import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { planMove } from '../lib/taskFlow'
import type { Task, TaskStatus } from '../lib/types'
import { ConfirmDialog, Modal } from './Modal'

const DENIED = {
  blocked: 'move.blocked',
  needs_review: 'move.needsReview',
  no_access: 'move.noAccess',
} as const

/**
 * Status changes from the table, the board, and the task window go through here, so a drag,
 * a dropdown, and the Approve/Reject buttons all follow the same rules.
 * `onChanged` should reload the list: one change can block or unblock other tasks.
 */
export function useTaskMover(onChanged: () => void, onOptimistic?: (taskId: string, status: TaskStatus) => void) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<Task | null>(null)
  const [finishing, setFinishing] = useState<Task | null>(null)

  async function update(task: Task, status: TaskStatus) {
    setBusyId(task.id)
    onOptimistic?.(task.id, status)
    const { error } = await supabase.from('tasks').update({ status }).eq('id', task.id)
    setBusyId(null)
    if (error) setError(errorMessage(t, error))
    onChanged()
  }

  async function approve(task: Task) {
    setError(null)
    setBusyId(task.id)
    onOptimistic?.(task.id, 'done')
    const { error } = await supabase.rpc('review_task', { p_task: task.id, p_approve: true })
    setBusyId(null)
    if (error) setError(errorMessage(t, error))
    onChanged()
  }

  function move(task: Task, target: TaskStatus) {
    setError(null)
    const plan = planMove(profile, task, target)
    if (!plan) return
    if (plan.kind === 'denied') return setError(t(DENIED[plan.reason]))
    if (plan.kind === 'reject') return setRejecting(task)
    if (plan.kind === 'approve') return approve(task)
    if (plan.status === 'done') return setFinishing(task)
    return update(task, plan.status)
  }

  const dialog = (
    <>
      {rejecting && (
        <RejectDialog
          task={rejecting}
          onCancel={() => setRejecting(null)}
          onRejected={() => {
            setRejecting(null)
            onChanged()
          }}
        />
      )}
      {finishing && (
        <ConfirmDialog
          title={t('done.confirmTitle')}
          message={t('done.confirmBody', { title: finishing.title })}
          confirmLabel={t('done.confirm')}
          tone="primary"
          onConfirm={() => {
            const task = finishing
            setFinishing(null)
            update(task, 'done')
          }}
          onCancel={() => {
            setFinishing(null)
            onChanged()
          }}
        />
      )}
    </>
  )

  return { move, approve, startReject: (task: Task) => setRejecting(task), busyId, error, clearError: () => setError(null), dialog }
}

function RejectDialog({ task, onCancel, onRejected }: { task: Task; onCancel: () => void; onRejected: () => void }) {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = note.trim()
    if (!text) return setError(t('review.noteRequired'))
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('review_task', { p_task: task.id, p_approve: false, p_note: text })
    if (error) {
      setBusy(false)
      return setError(errorMessage(t, error))
    }
    // The note already sits on the task; the comment keeps it in the history after the next review.
    await supabase.from('task_comments').insert({ task_id: task.id, body: t('review.commentPrefix', { note: text }).slice(0, 2000) })
    setBusy(false)
    onRejected()
  }

  return (
    <Modal
      title={t('review.rejectTitle')}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="reject-form" className="btn btn-danger" disabled={busy}>
            {busy ? t('common.saving') : t('review.reject')}
          </button>
        </>
      }
    >
      <form id="reject-form" onSubmit={submit} className="reject-form">
        <p>{t('review.rejectIntro', { title: task.title })}</p>
        <div className="field">
          <label htmlFor="reject-note">
            {t('review.noteLabel')} <span className="req" aria-hidden="true">*</span>
          </label>
          <textarea id="reject-note" rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

/** Approve / Reject pair for a task in Review, shown only to its reviewer (or the admin). */
export function ReviewButtons({
  task,
  busy,
  onApprove,
  onReject,
}: {
  task: Task
  busy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const { t } = useI18n()
  return (
    <span className="review-buttons">
      <button type="button" className="btn btn-sm btn-approve" disabled={busy} onClick={onApprove} aria-label={t('review.approveFor', { title: task.title })}>
        <span aria-hidden="true">✓</span> {t('review.approve')}
      </button>
      <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={onReject} aria-label={t('review.rejectFor', { title: task.title })}>
        {t('review.reject')}
      </button>
    </span>
  )
}
