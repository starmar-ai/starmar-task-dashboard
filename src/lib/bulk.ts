import { canEdit, planMove } from './taskFlow.ts'
import type { Profile, Task, TaskStatus } from './types.ts'

type Me = Pick<Profile, 'id' | 'role'> | null

/** Tasks the signed-in person may change. Only these can be ticked in the list. */
export function selectable<T extends Pick<Task, 'assignee_id' | 'created_by'>>(me: Me, tasks: T[]): T[] {
  return tasks.filter((task) => canEdit(me, task))
}

export type BulkMoveStep =
  | { id: string; kind: 'update'; status: TaskStatus }
  | { id: string; kind: 'approve' }
  | { id: string; kind: 'skip'; reason: 'blocked' | 'needs_review' | 'no_access' | 'review_note' | 'same' }

/**
 * What a bulk status change does to each task. It follows the same rules as moving one task by hand:
 * Blocked stays automatic, and a task with a reviewer reaches Done only through the reviewer.
 * Rejecting needs a note per task, so it is skipped here and done on the task itself.
 */
export function planBulkStatus(
  me: Me,
  tasks: Pick<Task, 'id' | 'status' | 'blocked_from' | 'assignee_id' | 'created_by' | 'reviewer_id'>[],
  target: TaskStatus,
): BulkMoveStep[] {
  return tasks.map((task) => {
    const plan = planMove(me, task, target)
    if (!plan) return { id: task.id, kind: 'skip', reason: 'same' }
    if (plan.kind === 'denied') return { id: task.id, kind: 'skip', reason: plan.reason }
    if (plan.kind === 'reject') return { id: task.id, kind: 'skip', reason: 'review_note' }
    if (plan.kind === 'approve') return { id: task.id, kind: 'approve' }
    return { id: task.id, kind: 'update', status: plan.status }
  })
}

export interface BulkResult {
  done: number
  skipped: number
  failed: number
  firstError?: string
}

/** Run one change per task, one after another, and count what happened. A failing task never stops the rest. */
export async function runEach<T extends { id: string }>(
  items: T[],
  action: (item: T) => Promise<{ message?: string } | null | undefined>,
): Promise<BulkResult> {
  const result: BulkResult = { done: 0, skipped: 0, failed: 0 }
  for (const item of items) {
    const error = await action(item)
    if (error) {
      result.failed += 1
      result.firstError ??= error.message
    } else result.done += 1
  }
  return result
}
