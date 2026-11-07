import { supabase } from './supabase'
import { removeFilesOfTasks } from './taskFiles'
import { daysBetween } from './dates'
import type { Task } from './types'

export const TRASH_DAYS = 30

/** Whole days left before a trashed task is removed for good (0 once it is due). */
export function daysLeft(deletedAt: string, today: string): number {
  return Math.max(0, TRASH_DAYS - daysBetween(deletedAt.slice(0, 10), today))
}

export async function purgeOne(taskId: string) {
  // Stored files are not removed with the row, so clear them first (best effort).
  await removeFilesOfTasks({ taskId })
  return supabase.rpc('purge_task', { p_task: taskId })
}

/** Remove Trash entries older than TRASH_DAYS that the signed-in user may edit. Returns how many went. */
export async function purgeExpired(today: string): Promise<number> {
  const { data, error } = await supabase.rpc('list_trash')
  if (error || !data) return 0
  const expired = (data as Task[]).filter((x) => x.deleted_at && daysLeft(x.deleted_at, today) === 0)
  for (const task of expired) await purgeOne(task.id)
  return expired.length
}
