import { useI18n } from '../lib/i18n'
import { BOARD_COLUMNS, canEdit, needsReviewer } from '../lib/taskFlow'
import type { Profile, Task, TaskStatus } from '../lib/types'
import { StatusChip } from './Chips'

/** Status dropdown for people who may move the task, a plain chip for everyone else and for Blocked. */
export function TaskStatusControl({
  task,
  me,
  busy,
  onMove,
}: {
  task: Task
  me: Profile | null
  busy: boolean
  onMove: (status: TaskStatus) => void
}) {
  const { t } = useI18n()
  if (task.status === 'blocked' || !canEdit(me, task)) return <StatusChip status={task.status} />
  const doneLocked = needsReviewer(me, task) && task.status !== 'done'
  return (
    <select
      className={`chip-select chip-status-${task.status}`}
      value={task.status}
      disabled={busy}
      aria-label={t('tasks.changeStatus', { title: task.title })}
      onChange={(e) => onMove(e.target.value as TaskStatus)}
    >
      {BOARD_COLUMNS.map((s) => (
        <option key={s} value={s} disabled={s === 'done' && doneLocked}>
          {s === 'done' && doneLocked ? t('tasks.doneViaReviewer') : t(`status.${s}`)}
        </option>
      ))}
    </select>
  )
}
