import { useState, type DragEvent } from 'react'
import { useI18n } from '../lib/i18n'
import { byDeadlineThenPriority } from '../lib/dashboard'
import { daysBetween, formatDate } from '../lib/dates'
import { BOARD_COLUMNS, boardColumn, canEdit, canReview, planMove } from '../lib/taskFlow'
import type { Profile, Project, Task, TaskStatus } from '../lib/types'
import { Avatar, PriorityChip, ProjectName, StatusChip } from './Chips'
import { ReviewButtons, type useTaskMover } from './TaskMover'
import { TaskStatusControl } from './TaskStatusControl'

const DONE_PREVIEW = 8

interface Props {
  tasks: Task[]
  today: string
  me: Profile | null
  showProject: boolean
  projectById: Map<string, Project>
  personById: Map<string, Profile>
  waitingTitles: (task: Task) => string[]
  mover: ReturnType<typeof useTaskMover>
  onOpen: (task: Task) => void
}

export function TaskBoard({ tasks, today, me, showProject, projectById, personById, waitingTitles, mover, onOpen }: Props) {
  const { t } = useI18n()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null)
  const [allDone, setAllDone] = useState(false)

  const dragTask = dragId ? tasks.find((x) => x.id === dragId) : undefined
  const accepts = (column: TaskStatus) => {
    if (!dragTask) return false
    const plan = planMove(me, dragTask, column)
    return !!plan && plan.kind !== 'denied'
  }

  function onDrop(e: DragEvent, column: TaskStatus) {
    e.preventDefault()
    setOverColumn(null)
    if (dragTask) mover.move(dragTask, column)
    setDragId(null)
  }

  return (
    <div className="board-wrap">
      <p className="muted small board-hint">{t('board.hint')}</p>
      <div className="board">
        {BOARD_COLUMNS.map((column) => {
          const all = tasks.filter((x) => boardColumn(x) === column)
          const sorted =
            column === 'done' ? [...all].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) : [...all].sort(byDeadlineThenPriority)
          const shown = column === 'done' && !allDone ? sorted.slice(0, DONE_PREVIEW) : sorted
          const blocked = all.filter((x) => x.status === 'blocked').length
          const dropState = dragTask ? (accepts(column) ? (overColumn === column ? 'is-over' : 'is-open') : 'is-closed') : ''
          return (
            <section
              key={column}
              className={`board-col board-col-${column} ${dropState}`}
              aria-label={t('board.column', { status: t(`status.${column}`), n: all.length })}
              onDragOver={(e) => {
                if (!accepts(column)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (overColumn !== column) setOverColumn(column)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverColumn(null)
              }}
              onDrop={(e) => onDrop(e, column)}
            >
              <header className="board-col-head">
                <StatusChip status={column} />
                <span className="board-count">{all.length}</span>
                {blocked > 0 && <span className="muted small">{t('board.blockedCount', { n: blocked })}</span>}
              </header>
              {shown.length === 0 ? (
                <p className="board-empty">{t('board.empty')}</p>
              ) : (
                <ul className="board-list">
                  {shown.map((task) => (
                    <BoardCard
                      key={task.id}
                      task={task}
                      today={today}
                      me={me}
                      project={showProject ? projectById.get(task.project_id) : undefined}
                      assignee={task.assignee_id ? personById.get(task.assignee_id) : undefined}
                      waiting={task.status === 'blocked' ? waitingTitles(task) : []}
                      mover={mover}
                      dragging={dragId === task.id}
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => {
                        setDragId(null)
                        setOverColumn(null)
                      }}
                      onOpen={() => onOpen(task)}
                    />
                  ))}
                </ul>
              )}
              {column === 'done' && sorted.length > DONE_PREVIEW && (
                <button type="button" className="btn btn-ghost btn-sm board-more" onClick={() => setAllDone((v) => !v)}>
                  {allDone ? t('board.showLessDone') : t('board.showAllDone', { n: sorted.length })}
                </button>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function BoardCard({
  task,
  today,
  me,
  project,
  assignee,
  waiting,
  mover,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  task: Task
  today: string
  me: Profile | null
  project?: Project
  assignee?: Profile
  waiting: string[]
  mover: ReturnType<typeof useTaskMover>
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
}) {
  const { t, locale } = useI18n()
  const late = task.status !== 'done' ? daysBetween(task.deadline, today) : null
  const reviewer = task.status === 'review' && canReview(me, task)
  const draggable = task.status !== 'blocked' && (canEdit(me, task) || reviewer)
  const busy = mover.busyId === task.id
  const name = assignee ? assignee.full_name || assignee.email : null

  return (
    <li
      className={`board-card ${task.status === 'blocked' ? 'is-blocked' : ''} ${late !== null && late > 0 ? 'is-overdue' : ''} ${dragging ? 'is-dragging' : ''} ${draggable ? 'is-draggable' : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', task.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="link-btn board-card-title" onClick={onOpen} aria-label={t('tasks.openTask', { title: task.title })}>
        {task.title}
      </button>
      {project && (
        <span className="small">
          <ProjectName name={project.name} color={project.color} />
        </span>
      )}
      <div className="board-card-meta">
        <span className="small">{formatDate(task.deadline, locale)}</span>
        {late !== null && late > 0 && <span className="chip chip-overdue">{t('tasks.overdue', { n: late })}</span>}
        {late === 0 && <span className="chip chip-today">{t('tasks.dueToday')}</span>}
        <PriorityChip priority={task.priority} />
      </div>
      {task.status === 'blocked' && (
        <p className="board-card-wait">
          <StatusChip status="blocked" />
          <span>{t('tasks.waitingFor', { titles: waiting.join(', ') || '?' })}</span>
        </p>
      )}
      {task.review_note && task.status === 'in_progress' && (
        <button type="button" className="chip chip-note" onClick={onOpen}>
          <span aria-hidden="true" className="chip-glyph">
            !
          </span>
          {t('tasks.reviewNoteFlag')}
        </button>
      )}
      <div className="board-card-foot">
        <span className="board-assignee">
          {name ? (
            <>
              <Avatar name={name} />
              <span>{assignee?.id === me?.id ? `${name} (${t('common.you')})` : name}</span>
            </>
          ) : (
            <span className="muted small">{t('common.none')}</span>
          )}
        </span>
        {task.status !== 'blocked' && canEdit(me, task) && <TaskStatusControl task={task} me={me} busy={busy} onMove={(s) => mover.move(task, s)} />}
      </div>
      {reviewer && <ReviewButtons task={task} busy={busy} onApprove={() => mover.approve(task)} onReject={() => mover.startReject(task)} />}
    </li>
  )
}
