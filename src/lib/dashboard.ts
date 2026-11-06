import type { Priority, Task } from './types'

export type PeriodKey = 'today' | '7d' | '1m' | 'custom'
export const PERIODS: PeriodKey[] = ['today', '7d', '1m', 'custom']

export interface Range {
  from: string
  to: string
}

export type Bucket = 'all' | 'overdue' | 'due'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(v: string | null | undefined): v is string {
  return !!v && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Same day next month, clamped to the month's last day (31 Jan -> 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

/** Inclusive date range for a period, starting today. Returns null for an invalid custom range. */
export function periodRange(period: PeriodKey, today: string, custom?: Partial<Range>): Range | null {
  switch (period) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: today, to: addDays(today, 6) }
    case '1m':
      return { from: today, to: addDays(addMonths(today, 1), -1) }
    case 'custom': {
      if (!isIsoDate(custom?.from) || !isIsoDate(custom?.to) || custom.from > custom.to) return null
      return { from: custom.from, to: custom.to }
    }
  }
}

export function isOpen(task: Pick<Task, 'status'>): boolean {
  return task.status !== 'done'
}

export function isOverdue(task: Pick<Task, 'status' | 'deadline'>, today: string): boolean {
  return isOpen(task) && task.deadline < today
}

/**
 * Open task due inside the period, from today onward. Days of a custom range that are already
 * past are left out because those tasks are counted as overdue instead, so no task is counted twice.
 */
export function isDueInRange(task: Pick<Task, 'status' | 'deadline'>, range: Range, today: string): boolean {
  const from = range.from > today ? range.from : today
  return isOpen(task) && task.deadline >= from && task.deadline <= range.to
}

export function inBucket(task: Pick<Task, 'status' | 'deadline'>, bucket: Bucket, range: Range, today: string): boolean {
  const overdue = isOverdue(task, today)
  const due = isDueInRange(task, range, today)
  if (bucket === 'overdue') return overdue
  if (bucket === 'due') return due
  return overdue || due
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

/** Oldest deadline first; on the same day, higher priority first. */
export function byDeadlineThenPriority(a: Task, b: Task): number {
  return a.deadline.localeCompare(b.deadline) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.created_at.localeCompare(b.created_at)
}

/** Open tasks that are late or due today/tomorrow (the D-1 window), regardless of the chosen period. */
export function needsAttention(tasks: Task[], today: string): Task[] {
  const tomorrow = addDays(today, 1)
  return tasks.filter((t) => isOpen(t) && t.deadline <= tomorrow).sort(byDeadlineThenPriority)
}

/**
 * Three tasks for today, from the user's own open tasks they can move right now: not Blocked,
 * and not sitting in Review waiting for someone else. Late and urgent work comes first, then the nearest deadline.
 */
export function focusToday(tasks: Task[], userId: string, today: string, limit = 3): Task[] {
  const waitingOnOthers = (t: Task) => t.status === 'review' && !!t.reviewer_id && t.reviewer_id !== userId
  const mine = tasks.filter((t) => t.assignee_id === userId && isOpen(t) && t.status !== 'blocked' && !waitingOnOthers(t))
  const score = (t: Task) => (t.deadline < today ? 0 : t.priority === 'urgent' && t.deadline <= addDays(today, 7) ? 1 : 2)
  return mine.sort((a, b) => score(a) - score(b) || byDeadlineThenPriority(a, b)).slice(0, limit)
}

export interface ProjectLoad {
  projectId: string
  overdue: number
  due: number
}

/** Per-project counts behind the chart, largest load first. */
export function loadByProject(tasks: Task[], range: Range, today: string): ProjectLoad[] {
  const map = new Map<string, ProjectLoad>()
  for (const t of tasks) {
    const overdue = isOverdue(t, today)
    const due = isDueInRange(t, range, today)
    if (!overdue && !due) continue
    const row = map.get(t.project_id) ?? { projectId: t.project_id, overdue: 0, due: 0 }
    if (overdue) row.overdue++
    else row.due++
    map.set(t.project_id, row)
  }
  return [...map.values()].sort((a, b) => b.overdue + b.due - (a.overdue + a.due) || b.overdue - a.overdue)
}
