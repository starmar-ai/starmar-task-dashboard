import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

/** Groups a person can switch off. Each notification belongs to exactly one. */
export const NOTIFICATION_KINDS = ['assigned', 'due_soon', 'overdue', 'review', 'comment', 'request', 'unblocked', 'team_overdue'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export type NotificationEvent =
  | 'assigned'
  | 'due_tomorrow'
  | 'due_today'
  | 'overdue'
  | 'team_overdue'
  | 'review_requested'
  | 'review_approved'
  | 'review_rejected'
  | 'comment'
  | 'request_new'
  | 'request_approved'
  | 'request_rejected'
  | 'request_stale'
  | 'unblocked'

export interface NotificationRow {
  id: string
  kind: NotificationKind
  event: NotificationEvent
  task_id: string
  actor_id: string | null
  detail: string | null
  field: string | null
  urgent: boolean
  created_at: string
  read_at: string | null
  task: { id: string; title: string; deadline: string; project_id: string; projects: { name: string; color: string } | null } | null
  actor: { full_name: string; email: string } | null
}

export interface NotificationSettings {
  muted_kinds: NotificationKind[]
  email_daily: boolean
  email_urgent: boolean
}

export const DEFAULT_SETTINGS: NotificationSettings = { muted_kinds: [], email_daily: true, email_urgent: true }

/** Where a notification leads: request events open the requests page, everything else the project's tasks. */
export function notificationTarget(n: Pick<NotificationRow, 'event' | 'task'>): string {
  if (n.event.startsWith('request_')) return '/requests'
  return n.task ? `/tasks?project=${n.task.project_id}` : '/tasks'
}

const EVENT = 'starmar:notifications-changed'

/** Tell the bell and an open list that something was read or the settings changed. */
export function emitNotificationsChanged() {
  window.dispatchEvent(new Event(EVENT))
}

const REFRESH_MS = 60_000

/** Unread count for the bell. Refreshes every minute, when the tab regains focus, and after a read. */
export function useUnreadCount(userId: string | undefined, routeKey: string): number {
  const [count, setCount] = useState(0)
  const load = useCallback(async () => {
    if (!userId) return
    // Inner join on the task: news about a trashed or deleted task is not listed, so it must not be counted either.
    const { count: n, error } = await supabase
      .from('notifications')
      .select('id, task:tasks!task_id!inner(id)', { count: 'exact', head: true })
      .is('read_at', null)
    if (!error) setCount(n ?? 0)
  }, [userId])

  useEffect(() => {
    load()
  }, [load, routeKey])

  useEffect(() => {
    const timer = window.setInterval(load, REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    window.addEventListener(EVENT, load)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(EVENT, load)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  return count
}
