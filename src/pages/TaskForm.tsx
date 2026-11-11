import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { canEditTask } from '../lib/permissions'
import { canReview, needsReviewer } from '../lib/taskFlow'
import { formatDate, formatDateTime } from '../lib/dates'
import { pickablePeople } from '../lib/team'
import type { useLookups } from '../lib/useTeam'
import { PRIORITIES, SWATCHES, type Label, type Priority, type Task, type TaskStatus } from '../lib/types'
import { ConfirmDialog, Modal } from '../components/Modal'
import { StatusChip } from '../components/Chips'
import { TaskDependencies } from '../components/TaskDependencies'
import { ReviewButtons, useTaskMover } from '../components/TaskMover'
import { TaskComments } from '../components/TaskComments'
import { TaskChecklist } from '../components/TaskChecklist'
import { TaskFiles } from '../components/TaskFiles'
import { DateChangeDialog, sameDates } from '../components/TaskDateChange'
import { emitRequestsChanged } from '../lib/requestEvents'
import { ChangeRequestDialog } from '../components/ChangeRequestDialog'
import { TaskChangeRequests } from '../components/ChangeRequestCard'

interface Props {
  /** A draft with an empty id opens the form in "new task" mode. */
  task: Task
  lookups: ReturnType<typeof useLookups>
  onClose: () => void
  /** Something outside the form fields changed (waiting list, review); the list behind should reload. */
  onChanged?: () => void
  onSaved: (task: Task) => void
  onDeleted: (id: string) => void
}

export function TaskForm({ task, lookups, onClose, onChanged, onSaved, onDeleted }: Props) {
  const { t, locale } = useI18n()
  const { profile } = useAuth()
  const isNew = !task.id
  const editable = isNew || canEditTask(profile, task)

  const [title, setTitle] = useState(task.title)
  const [projectId, setProjectId] = useState(task.project_id)
  const [deadline, setDeadline] = useState(task.deadline)
  const [startDate, setStartDate] = useState(task.start_date ?? '')
  const [status, setStatus] = useState<TaskStatus>(task.status)
  // Status as the database last reported it; the waiting list can change it while the form is open.
  const [live, setLive] = useState<Pick<Task, 'status' | 'blocked_from'>>({ status: task.status, blocked_from: task.blocked_from })
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? '')
  const [reviewerId, setReviewerId] = useState(task.reviewer_id ?? '')
  const [description, setDescription] = useState(task.description ?? '')
  const [labelIds, setLabelIds] = useState<string[]>(task.task_labels.map((l) => l.label_id))
  const [newLabel, setNewLabel] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDates, setConfirmDates] = useState(false)
  const [confirmDone, setConfirmDone] = useState(false)
  const [asking, setAsking] = useState(false)
  const [leaving, setLeaving] = useState<{ after?: () => void } | null>(null)
  const navigate = useNavigate()
  const [requestsKey, setRequestsKey] = useState(0)

  const mover = useTaskMover(() => {
    onChanged?.()
    onClose()
  })
  const reviewerPerson = lookups.people.find((p) => p.id === task.reviewer_id)
  const notePerson = lookups.people.find((p) => p.id === task.review_note_by)
  const showReview = live.status === 'review' && !!task.reviewer_id
  const doneLocked = needsReviewer(profile, { reviewer_id: reviewerId || null }) && live.status !== 'done'
  const creator = lookups.people.find((p) => p.id === task.created_by)
  const projects = lookups.projects.filter((p) => !p.archived || p.id === task.project_id)

  const sameLabels = labelIds.length === task.task_labels.length && labelIds.every((id) => task.task_labels.some((l) => l.label_id === id))
  const dirty =
    editable &&
    (title !== task.title ||
      projectId !== task.project_id ||
      deadline !== task.deadline ||
      startDate !== (task.start_date ?? '') ||
      status !== live.status ||
      priority !== task.priority ||
      assigneeId !== (task.assignee_id ?? '') ||
      reviewerId !== (task.reviewer_id ?? '') ||
      description !== (task.description ?? '') ||
      !sameLabels ||
      newLabel.trim() !== '')

  /** Close the window; when something was changed, ask first (save, discard, or keep editing). */
  function requestClose(after?: () => void) {
    if (dirty) return setLeaving({ after })
    onClose()
    after?.()
  }

  async function addLabel() {
    const name = newLabel.trim()
    if (!name) return
    const existing = lookups.labels.find((l) => l.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      setLabelIds((ids) => (ids.includes(existing.id) ? ids : [...ids, existing.id]))
      setNewLabel('')
      return
    }
    const color = SWATCHES[lookups.labels.length % SWATCHES.length]
    const { data, error } = await supabase.from('labels').insert({ name, color }).select('id,name,color').single()
    if (error) return setError(errorMessage(t, error))
    lookups.setLabels((prev) => [...prev, data as Label].sort((a, b) => a.name.localeCompare(b.name)))
    setLabelIds((ids) => [...ids, (data as Label).id])
    setNewLabel('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim() || !projectId || !deadline) return setError(t('taskForm.required'))
    if (startDate && startDate > deadline) return setError(t('taskForm.startAfterDeadline'))
    if (!isNew && status === 'done' && live.status !== 'done' && !confirmDone) return setConfirmDone(true)
    const datesChanged = !isNew && !sameDates({ start: task.start_date, end: task.deadline }, { start: startDate || null, end: deadline })
    if (datesChanged && !confirmDates) return setConfirmDates(true)
    await save()
  }

  async function create() {
    setBusy(true)
    const { data, error: insErr } = await supabase
      .from('tasks')
      .insert({
        title: title.trim(),
        project_id: projectId,
        deadline,
        start_date: startDate || null,
        priority,
        assignee_id: assigneeId || null,
        reviewer_id: reviewerId || null,
        description: description.trim() || null,
      })
      .select('*, task_labels(label_id)')
      .single()
    if (insErr) {
      setBusy(false)
      return setError(errorMessage(t, insErr))
    }
    if (labelIds.length) {
      const { error: labelErr } = await supabase.from('task_labels').insert(labelIds.map((label_id) => ({ task_id: (data as Task).id, label_id })))
      if (labelErr) {
        setBusy(false)
        return setError(errorMessage(t, labelErr))
      }
    }
    setBusy(false)
    onSaved(data as Task)
  }

  async function save() {
    setConfirmDates(false)
    setConfirmDone(false)
    if (isNew) return create()
    setBusy(true)
    const { error: updErr } = await supabase
      .from('tasks')
      .update({
        title: title.trim(),
        project_id: projectId,
        deadline,
        start_date: startDate || null,
        ...(status !== live.status ? { status } : {}),
        priority,
        assignee_id: assigneeId || null,
        reviewer_id: reviewerId || null,
        description: description.trim() || null,
      })
      .eq('id', task.id)
    if (updErr) {
      setBusy(false)
      return setError(errorMessage(t, updErr))
    }

    const before = new Set(task.task_labels.map((l) => l.label_id))
    const after = new Set(labelIds)
    const toAdd = [...after].filter((id) => !before.has(id))
    const toRemove = [...before].filter((id) => !after.has(id))
    if (toAdd.length) {
      const { error: e1 } = await supabase.from('task_labels').insert(toAdd.map((label_id) => ({ task_id: task.id, label_id })))
      if (e1) {
        setBusy(false)
        return setError(errorMessage(t, e1))
      }
    }
    if (toRemove.length) {
      const { error: e2 } = await supabase.from('task_labels').delete().eq('task_id', task.id).in('label_id', toRemove)
      if (e2) {
        setBusy(false)
        return setError(errorMessage(t, e2))
      }
    }

    const { data, error: reloadErr } = await supabase.from('tasks').select('*, task_labels(label_id)').eq('id', task.id).single()
    setBusy(false)
    if (reloadErr) return setError(errorMessage(t, reloadErr))
    onSaved(data as Task)
  }

  async function onDelete() {
    setBusy(true)
    const { error } = await supabase.rpc('trash_task', { p_task: task.id })
    setBusy(false)
    setConfirmDelete(false)
    if (error) return setError(errorMessage(t, error))
    onDeleted(task.id)
  }

  const people = lookups.people
  const selectedProject = lookups.projects.find((p) => p.id === projectId)
  const pickable = pickablePeople(people, selectedProject, lookups.members, [assigneeId, reviewerId])
  const outsider = (id: string) => !!id && !pickablePeople(people, selectedProject, lookups.members).some((p) => p.id === id)
  const reviewerLocked = !(profile?.role === 'admin' || task.created_by === profile?.id)

  return (
    <>
      <Modal
        title={isNew ? t('taskForm.newTitle') : t('taskForm.editTitle')}
        onClose={() => requestClose()}
        footer={
          editable ? (
            <>
              {!isNew && (
                <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
                  {t('common.delete')}
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="btn btn-secondary" onClick={() => requestClose()}>
                {t('common.cancel')}
              </button>
              <button type="submit" form="task-form" className="btn btn-primary" disabled={busy}>
                {busy ? t('common.saving') : isNew ? t('tasks.add') : t('common.save')}
              </button>
            </>
          ) : (
            <>
              {!isNew && (
                <button type="button" className="btn btn-primary" onClick={() => setAsking(true)}>
                  {t('cr.ask')}
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t('common.close')}
              </button>
            </>
          )
        }
      >
        {!editable && <p className="form-info">{t('taskForm.readOnly')}</p>}
        {task.review_note && live.status !== 'done' && (
          <div className="review-note" role="note">
            <p className="review-note-head">
              <span className="chip chip-overdue">
                <span aria-hidden="true" className="chip-glyph">
                  !
                </span>
                {t('tasks.reviewNoteFlag')}
              </span>
              {t('review.noteBox', {
                name: notePerson?.full_name || notePerson?.email || '?',
                date: task.review_note_at ? formatDateTime(task.review_note_at, locale, profile?.timezone ?? 'Asia/Jakarta') : '',
              })}
            </p>
            <p className="review-note-body">{task.review_note}</p>
          </div>
        )}
        {showReview && (
          <div className="review-bar">
            <p>{canReview(profile, task) ? t('review.yourTurn') : t('review.waiting', { name: reviewerPerson?.full_name || reviewerPerson?.email || '?' })}</p>
            {canReview(profile, task) && (
              <ReviewButtons task={task} busy={mover.busyId === task.id} onApprove={() => mover.approve(task)} onReject={() => mover.startReject(task)} />
            )}
          </div>
        )}
        {mover.error && (
          <p className="form-error" role="alert">
            {mover.error}
          </p>
        )}
        <form id="task-form" onSubmit={onSubmit}>
          <fieldset disabled={!editable} className="form-grid">
            <div className="field span-2">
              <label htmlFor="tf-title">
                {t('taskForm.title')} <span className="req" aria-hidden="true">*</span>
              </label>
              <input id="tf-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="tf-project">
                {t('taskForm.project')} <span className="req" aria-hidden="true">*</span>
              </label>
              <select id="tf-project" required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {isNew && <option value="">{t('tasks.pickProject')}</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tf-deadline">
                {t('taskForm.deadline')} <span className="req" aria-hidden="true">*</span>
              </label>
              <input id="tf-deadline" type="date" required value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            {!isNew && (
            <div className="field">
              {live.status === 'blocked' ? (
                <>
                  <span className="field-label">{t('taskForm.status')}</span>
                  <span>
                    <StatusChip status="blocked" />
                  </span>
                  <span className="muted small">{t('taskForm.blockedNow', { status: t(`status.${live.blocked_from && live.blocked_from !== 'blocked' ? live.blocked_from : 'todo'}`) })}</span>
                </>
              ) : (
                <>
                  <label htmlFor="tf-status">{t('taskForm.status')}</label>
                  <select id="tf-status" className={`chip-select chip-status-${status}`} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                    {(['todo', 'in_progress', 'review', 'done'] as TaskStatus[]).map((s) => (
                      <option key={s} value={s} disabled={s === 'done' && doneLocked}>
                        {s === 'done' && doneLocked ? t('tasks.doneViaReviewer') : t(`status.${s}`)}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            )}
            <div className="field">
              <label htmlFor="tf-priority">{t('taskForm.priority')}</label>
              <select id="tf-priority" className={`chip-select chip-priority-${priority}`} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`priority.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tf-assignee">{t('taskForm.assignee')}</label>
              <select id="tf-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">{t('common.none')}</option>
                {pickable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.full_name || p.email}${outsider(p.id) ? ` (${t('team.noAccessShort')})` : ''}`}
                  </option>
                ))}
              </select>
              {(outsider(assigneeId) || outsider(reviewerId)) && <span className="muted small">{t('team.pickHint')}</span>}
            </div>
            <div className="field">
              <label htmlFor="tf-reviewer">
                {t('taskForm.reviewer')} <span className="muted">({t('common.optional')})</span>
              </label>
              <select
                id="tf-reviewer"
                value={reviewerId}
                disabled={reviewerLocked}
                aria-describedby={reviewerLocked ? 'tf-reviewer-note' : undefined}
                onChange={(e) => setReviewerId(e.target.value)}
              >
                <option value="">{t('common.none')}</option>
                {pickable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.full_name || p.email}${outsider(p.id) ? ` (${t('team.noAccessShort')})` : ''}`}
                  </option>
                ))}
              </select>
              {reviewerLocked && (
                <span id="tf-reviewer-note" className="muted small">
                  {t('taskForm.reviewerLocked')}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="tf-start">
                {t('taskForm.startDate')} <span className="muted">({t('common.optional')})</span>
              </label>
              <input id="tf-start" type="date" value={startDate} max={deadline || undefined} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="field span-2">
              <label htmlFor="tf-desc">
                {t('taskForm.description')} <span className="muted">({t('common.optional')})</span>
              </label>
              <textarea id="tf-desc" rows={4} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field span-2">
              <div className="field-label-row">
                <span className="field-label" id="tf-labels-label">
                  {t('taskForm.labels')}
                </span>
                <button type="button" className="link-btn" onClick={() => requestClose(() => navigate('/settings#s-labels'))}>
                  {t('taskForm.editLabels')}
                </button>
              </div>
              <div className="label-picker" role="group" aria-labelledby="tf-labels-label">
                {lookups.labels.map((l) => {
                  const on = labelIds.includes(l.id)
                  return (
                    <label key={l.id} className={`label-option ${on ? 'is-on' : ''}`} style={on ? { background: l.color } : undefined}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setLabelIds((ids) => (e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id)))}
                      />
                      {l.name}
                    </label>
                  )
                })}
              </div>
              <div className="inline-add">
                <label htmlFor="tf-newlabel" className="sr-only">
                  {t('taskForm.newLabel')}
                </label>
                <input
                  id="tf-newlabel"
                  placeholder={t('taskForm.newLabel')}
                  maxLength={40}
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addLabel()
                    }
                  }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={addLabel}>
                  {t('taskForm.addLabel')}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {isNew ? (
          <p className="muted small">{t('taskForm.newHint')}</p>
        ) : (
          <>
            <p className="muted small">
              {t('taskForm.createdBy', {
                name: creator?.full_name || creator?.email || '?',
                date: formatDate(task.created_at.slice(0, 10), locale),
              })}
            </p>
            <TaskChangeRequests
              task={task}
              people={people}
              refreshKey={requestsKey}
              onChanged={() => {
                onChanged?.()
                onClose()
              }}
            />
            <TaskDependencies
              task={task}
              canManage={editable}
              onChanged={(fresh) => {
                setLive(fresh)
                setStatus(fresh.status)
                onChanged?.()
              }}
            />
            <TaskChecklist task={task} canManage={editable} onChanged={onChanged} />
            <TaskFiles taskId={task.id} canManage={editable} people={people} />
            <TaskComments taskId={task.id} people={people} />
          </>
        )}
      </Modal>
      {confirmDelete && (
        <ConfirmDialog
          title={t('taskForm.deleteTitle')}
          message={t('taskForm.deleteConfirm', { title: task.title })}
          confirmLabel={t('taskForm.moveToTrash')}
          busy={busy}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {confirmDone && (
        <ConfirmDialog
          title={t('done.confirmTitle')}
          message={t('done.confirmBody', { title: task.title })}
          confirmLabel={t('done.confirm')}
          tone="primary"
          busy={busy}
          onConfirm={save}
          onCancel={() => setConfirmDone(false)}
        />
      )}
      {confirmDates && (
        <DateChangeDialog
          title={task.title}
          before={{ start: task.start_date, end: task.deadline }}
          after={{ start: startDate || null, end: deadline }}
          hasDependencies={false}
          busy={busy}
          error={null}
          onConfirm={save}
          onCancel={() => setConfirmDates(false)}
        />
      )}
      {asking && (
        <ChangeRequestDialog
          task={task}
          lookups={lookups}
          onClose={() => setAsking(false)}
          onSent={() => {
            setAsking(false)
            emitRequestsChanged()
            setRequestsKey((k) => k + 1)
          }}
        />
      )}
      {leaving && (
        <Modal
          title={t('taskForm.unsavedTitle')}
          size="sm"
          onClose={() => setLeaving(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setLeaving(null)}>
                {t('taskForm.keepEditing')}
              </button>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const after = leaving.after
                  setLeaving(null)
                  onClose()
                  after?.()
                }}
              >
                {t('taskForm.discard')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setLeaving(null)
                  ;(document.getElementById('task-form') as HTMLFormElement | null)?.requestSubmit()
                }}
              >
                {t('common.save')}
              </button>
            </>
          }
        >
          <p>{t('taskForm.unsavedBody')}</p>
        </Modal>
      )}
      {mover.dialog}
    </>
  )
}
