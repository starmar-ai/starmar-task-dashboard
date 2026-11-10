import { addDays } from './dates.ts'
import type { Profile, Task } from './types'

export interface WorkloadRow<T = Task> {
  /** null is the "no assignee" row. */
  personId: string | null
  /** Unfinished tasks. */
  open: number
  overdue: number
  /** Due today or in the next 6 days, not yet late. */
  dueWeek: number
  /** Everything else that is open: due in 7 days or later. */
  later: number
  urgent: number
  /** Tasks sitting in Review that this person has to approve. */
  toReview: number
  /** Open tasks, most pressing first: late, then nearest deadline. */
  tasks: T[]
}

type TaskLite = Pick<Task, 'id' | 'status' | 'deadline' | 'priority' | 'assignee_id' | 'reviewer_id'>
type PersonLite = Pick<Profile, 'id' | 'active' | 'full_name' | 'email'>

/** One row per active person plus the unassigned tasks (when there are any). Done tasks do not count. */
export function buildWorkload<T extends TaskLite>(tasks: T[], people: PersonLite[], today: string): WorkloadRow<T>[] {
  const weekEnd = addDays(today, 6)
  const open = tasks.filter((t) => t.status !== 'done')
  const rowFor = (personId: string | null) => {
    const mine = open
      .filter((t) => (t.assignee_id ?? null) === personId)
      .sort((a, b) => a.deadline.localeCompare(b.deadline))
    return {
      personId,
      open: mine.length,
      overdue: mine.filter((t) => t.deadline < today).length,
      dueWeek: mine.filter((t) => t.deadline >= today && t.deadline <= weekEnd).length,
      later: mine.filter((t) => t.deadline > weekEnd).length,
      urgent: mine.filter((t) => t.priority === 'urgent').length,
      toReview: personId ? open.filter((t) => t.status === 'review' && t.reviewer_id === personId).length : 0,
      tasks: mine,
    }
  }
  const rows = people
    .filter((p) => p.active !== false)
    .map((p) => rowFor(p.id))
    .sort((a, b) => b.open - a.open || b.overdue - a.overdue)
  const unassigned = rowFor(null)
  return unassigned.open > 0 ? [...rows, unassigned] : rows
}
