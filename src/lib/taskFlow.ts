import type { Profile, Task, TaskDependency, TaskStatus } from './types'

/** Board columns, in the order work moves. Blocked is not a column: a blocked card stays in the column it returns to. */
export const BOARD_COLUMNS: Exclude<TaskStatus, 'blocked'>[] = ['todo', 'in_progress', 'review', 'done']

type Me = Pick<Profile, 'id' | 'role'> | null
type FlowTask = Pick<Task, 'status' | 'blocked_from' | 'assignee_id' | 'created_by' | 'reviewer_id'>

export function isAdmin(me: Me): boolean {
  return me?.role === 'admin'
}

export function canEdit(me: Me, task: Pick<Task, 'assignee_id' | 'created_by'>): boolean {
  if (!me) return false
  return isAdmin(me) || task.assignee_id === me.id || task.created_by === me.id
}

/** The reviewer named on the task, or the admin. Only meaningful when the task has a reviewer. */
export function canReview(me: Me, task: Pick<Task, 'reviewer_id'>): boolean {
  if (!me || !task.reviewer_id) return false
  return task.reviewer_id === me.id || isAdmin(me)
}

/** A task with a reviewer reaches Done only through that reviewer (or the admin). */
export function needsReviewer(me: Me, task: Pick<Task, 'reviewer_id'>): boolean {
  return !!task.reviewer_id && !canReview(me, task)
}

/** Column a card sits in. A blocked card stays where it will return once unblocked. */
export function boardColumn(task: Pick<Task, 'status' | 'blocked_from'>): Exclude<TaskStatus, 'blocked'> {
  if (task.status !== 'blocked') return task.status
  return task.blocked_from && task.blocked_from !== 'blocked' ? task.blocked_from : 'todo'
}

export type Move =
  | { kind: 'update'; status: TaskStatus }
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'denied'; reason: 'blocked' | 'needs_review' | 'no_access' }

/**
 * What moving a task to a status means for this user. The database enforces the same rules;
 * this keeps the UI from offering moves that would only fail.
 */
export function planMove(me: Me, task: FlowTask, target: TaskStatus): Move | null {
  if (target === task.status) return null
  if (task.status === 'blocked' || target === 'blocked') return { kind: 'denied', reason: 'blocked' }
  const reviewer = canReview(me, task)
  if (task.status === 'review' && reviewer) {
    if (target === 'done') return { kind: 'approve' }
    if (target === 'in_progress') return { kind: 'reject' }
  }
  if (!canEdit(me, task)) return { kind: 'denied', reason: 'no_access' }
  if (target === 'done' && needsReviewer(me, task)) return { kind: 'denied', reason: 'needs_review' }
  return { kind: 'update', status: target }
}

export interface DependencyIndex {
  /** task id -> ids of the tasks it waits for */
  waitsFor: Map<string, string[]>
  /** task id -> ids of the tasks waiting for it */
  waitedBy: Map<string, string[]>
}

export function indexDependencies(deps: Pick<TaskDependency, 'task_id' | 'depends_on_id'>[]): DependencyIndex {
  const waitsFor = new Map<string, string[]>()
  const waitedBy = new Map<string, string[]>()
  for (const d of deps) {
    waitsFor.set(d.task_id, [...(waitsFor.get(d.task_id) ?? []), d.depends_on_id])
    waitedBy.set(d.depends_on_id, [...(waitedBy.get(d.depends_on_id) ?? []), d.task_id])
  }
  return { waitsFor, waitedBy }
}

/** True when "taskId waits for dependsOnId" would close a loop (dependsOnId already waits for taskId, directly or further down). */
export function wouldCreateCycle(deps: Pick<TaskDependency, 'task_id' | 'depends_on_id'>[], taskId: string, dependsOnId: string): boolean {
  if (taskId === dependsOnId) return true
  const { waitsFor } = indexDependencies(deps)
  const seen = new Set<string>()
  const stack = [dependsOnId]
  while (stack.length) {
    const id = stack.pop()!
    if (id === taskId) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(waitsFor.get(id) ?? []))
  }
  return false
}
