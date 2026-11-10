export type ChangeField = 'title' | 'description' | 'priority' | 'start_date' | 'deadline' | 'assignee_id'
export type ChangeStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export const CHANGE_FIELDS: ChangeField[] = ['deadline', 'start_date', 'priority', 'assignee_id', 'title', 'description']
export const DATE_FIELDS: ChangeField[] = ['deadline', 'start_date']

/** Fields that may be emptied: the request then asks to clear the value. */
export const CLEARABLE: ChangeField[] = ['start_date', 'description', 'assignee_id']

export interface ChangeRequest {
  id: string
  task_id: string
  requester_id: string | null
  field: ChangeField
  old_value: string | null
  new_value: string | null
  reason: string
  status: ChangeStatus
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

/** The admin is reminded once a request has waited this many working days. */
export const REMINDER_AFTER_WORKING_DAYS = 2

/** Calendar date (YYYY-MM-DD) of a timestamp in a timezone. */
export function dateIn(timestamp: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp))
}

/**
 * Working days (Mon-Fri) that have passed after `from`, up to and including `to`.
 * Asked on Friday, still open on Tuesday: Monday and Tuesday count, so 2.
 * Holidays are not known to the app yet, so they count as working days.
 */
export function workingDaysBetween(from: string, to: string): number {
  let n = 0
  const end = Date.parse(`${to}T00:00:00Z`)
  for (let ms = Date.parse(`${from}T00:00:00Z`) + 86_400_000; ms <= end; ms += 86_400_000) {
    const day = new Date(ms).getUTCDay()
    if (day !== 0 && day !== 6) n++
  }
  return n
}

export function needsReminder(r: Pick<ChangeRequest, 'status' | 'created_at'>, today: string, timezone: string): boolean {
  return r.status === 'pending' && workingDaysBetween(dateIn(r.created_at, timezone), today) >= REMINDER_AFTER_WORKING_DAYS
}

/** Who may decide: the admin, or the task owner who is not the asker. Mirrors decide_change_request in the database. */
export function canDecide(
  me: { id: string; role: 'admin' | 'member' } | null,
  request: Pick<ChangeRequest, 'requester_id'>,
  task: { assignee_id: string | null; created_by: string | null } | undefined,
): boolean {
  if (!me) return false
  if (me.role === 'admin') return true
  if (!task || request.requester_id === me.id) return false
  return task.assignee_id === me.id || task.created_by === me.id
}
