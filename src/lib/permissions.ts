import type { Profile, Task } from './types'

export function canEditTask(me: Profile | null, task: Pick<Task, 'assignee_id' | 'created_by'>): boolean {
  if (!me) return false
  return me.role === 'admin' || task.assignee_id === me.id || task.created_by === me.id
}
