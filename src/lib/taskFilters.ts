import { addDays, isIsoDate } from './dashboard.ts'
import type { Priority, Task, TaskStatus } from './types.ts'
import { PRIORITIES, TASK_STATUSES } from './types.ts'

/** "me" stands for whoever is signed in, so a saved filter keeps working for each person. */
export const ME = 'me'

export type DueKey = 'overdue' | 'week'
export type SortKey = 'deadline' | 'priority' | 'newest' | 'title'
export const SORTS: SortKey[] = ['deadline', 'priority', 'newest', 'title']

export interface TaskFilter {
  q: string
  project: string
  assignee: string
  reviewer: string
  status: TaskStatus | ''
  priority: Priority | ''
  label: string
  due: DueKey | ''
  from: string
  to: string
  sort: SortKey
  done: boolean
}

/** URL params that make up a filter. `view` is left out on purpose: a filter works in every view. */
const KEYS = ['q', 'project', 'assignee', 'reviewer', 'status', 'priority', 'label', 'due', 'from', 'to', 'sort', 'done'] as const

export const EMPTY_FILTER: TaskFilter = {
  q: '',
  project: '',
  assignee: '',
  reviewer: '',
  status: '',
  priority: '',
  label: '',
  due: '',
  from: '',
  to: '',
  sort: 'deadline',
  done: false,
}

export function parseFilter(params: URLSearchParams): TaskFilter {
  const status = params.get('status') ?? ''
  const priority = params.get('priority') ?? ''
  const due = params.get('due') ?? ''
  const sort = params.get('sort') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  return {
    q: params.get('q') ?? '',
    project: params.get('project') ?? '',
    assignee: params.get('assignee') ?? '',
    reviewer: params.get('reviewer') ?? '',
    status: (TASK_STATUSES as string[]).includes(status) ? (status as TaskStatus) : '',
    priority: (PRIORITIES as string[]).includes(priority) ? (priority as Priority) : '',
    label: params.get('label') ?? '',
    due: due === 'overdue' || due === 'week' ? due : '',
    from: isIsoDate(from) ? from : '',
    to: isIsoDate(to) ? to : '',
    sort: (SORTS as string[]).includes(sort) ? (sort as SortKey) : 'deadline',
    done: params.get('done') === '1',
  }
}

/** Query string for a filter, empty values and defaults left out. Same filter always gives the same string. */
export function filterToQuery(f: TaskFilter): string {
  const p = new URLSearchParams()
  for (const key of KEYS) {
    if (key === 'done') {
      if (f.done) p.set('done', '1')
    } else if (key === 'sort') {
      if (f.sort !== 'deadline') p.set('sort', f.sort)
    } else if (f[key]) p.set(key, f[key])
  }
  return p.toString()
}

/** Filter params found in a stored query string; anything unknown is dropped. */
export function normalizeQuery(query: string): string {
  return filterToQuery(parseFilter(new URLSearchParams(query)))
}

/** How many filters are switched on (search text, sort and "show Done" do not count). */
export function activeCount(f: TaskFilter): number {
  return [f.project, f.assignee, f.reviewer, f.status, f.priority, f.label, f.due, f.from, f.to].filter(Boolean).length
}

export function isFiltered(f: TaskFilter): boolean {
  return filterToQuery(f) !== ''
}

export interface Preset {
  key: 'mine' | 'overdue' | 'review' | 'week'
  patch: Partial<TaskFilter>
}

export const PRESETS: Preset[] = [
  { key: 'mine', patch: { assignee: ME } },
  { key: 'overdue', patch: { due: 'overdue' } },
  { key: 'review', patch: { reviewer: ME, status: 'review' } },
  { key: 'week', patch: { due: 'week' } },
]

/** A preset is on when exactly its own fields are set (other fields do not matter). */
export function presetIsOn(f: TaskFilter, preset: Preset): boolean {
  return (Object.entries(preset.patch) as [keyof TaskFilter, unknown][]).every(([k, v]) => f[k] === v)
}

/** Sunday of the week that holds `today` (weeks run Monday to Sunday). */
export function endOfWeek(today: string): string {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay()
  return addDays(today, day === 0 ? 0 : 7 - day)
}

export interface FilterContext {
  meId: string | undefined
  today: string
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

function who(value: string, ctx: FilterContext): string {
  return value === ME ? (ctx.meId ?? '') : value
}

export function matchesFilter(task: Task, f: TaskFilter, ctx: FilterContext): boolean {
  const q = f.q.trim().toLowerCase()
  if (q && !task.title.toLowerCase().includes(q) && !(task.description ?? '').toLowerCase().includes(q)) return false
  if (f.project && task.project_id !== f.project) return false
  if (f.assignee && task.assignee_id !== who(f.assignee, ctx)) return false
  if (f.reviewer && task.reviewer_id !== who(f.reviewer, ctx)) return false
  if (f.status && task.status !== f.status) return false
  if (f.priority && task.priority !== f.priority) return false
  if (f.label && !task.task_labels.some((l) => l.label_id === f.label)) return false
  if (f.from && task.deadline < f.from) return false
  if (f.to && task.deadline > f.to) return false
  if (f.due === 'overdue' && !(task.status !== 'done' && task.deadline < ctx.today)) return false
  if (f.due === 'week' && !(task.status !== 'done' && task.deadline >= ctx.today && task.deadline <= endOfWeek(ctx.today))) return false
  return true
}

export function compareTasks(sort: SortKey): (a: Task, b: Task) => number {
  switch (sort) {
    case 'priority':
      return (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.deadline.localeCompare(b.deadline)
    case 'newest':
      return (a, b) => b.created_at.localeCompare(a.created_at)
    case 'title':
      return (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    default:
      return (a, b) => a.deadline.localeCompare(b.deadline) || a.created_at.localeCompare(b.created_at)
  }
}
