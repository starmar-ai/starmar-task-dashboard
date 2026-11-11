export type Role = 'admin' | 'member'
export type Locale = 'id' | 'en'
export type Theme = 'light' | 'dark'
export type ProjectStatus = 'perencanaan' | 'aktif' | 'ditunda' | 'selesai'
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'blocked'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  locale: Locale
  timezone: string
  theme: Theme
  /** False when the admin revoked access, or the account was not made through an invite. */
  active: boolean
}

export interface Project {
  id: string
  name: string
  color: string
  pm_id: string | null
  status: ProjectStatus
  client_label: string | null
  archived: boolean
}

export interface ProjectOverview extends Project {
  task_total: number
  task_done: number
  task_overdue: number
  first_date: string | null
  last_deadline: string | null
  at_risk: boolean
  /** Latest completed_at among the tasks, only for an archived project whose tasks are all Done. */
  finished_at: string | null
}

export interface Label {
  id: string
  name: string
  color: string
}

export interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: Priority
  start_date: string | null
  deadline: string
  assignee_id: string | null
  reviewer_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  /** While Blocked: the status the task returns to once everything it waits for is Done. */
  blocked_from: TaskStatus | null
  review_note: string | null
  review_note_by: string | null
  review_note_at: string | null
  /** When the task last became Done; empty while it is open. */
  completed_at?: string | null
  /** Added by the task list, not stored: the task's project is in the Archive, so the task is read-only. */
  project_archived?: boolean
  /** Set while the task sits in Trash; trashed tasks only come back through list_trash(). */
  deleted_at?: string | null
  task_labels: { label_id: string }[]
  /** Only present when the page asked for it (task list and board): used for the checklist progress. */
  task_checklist_items?: { done: boolean }[]
}

/** task_id waits for depends_on_id: it stays Blocked until depends_on_id is Done. */
export interface TaskDependency {
  task_id: string
  depends_on_id: string
}

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done', 'blocked']
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']
export const PROJECT_STATUSES: ProjectStatus[] = ['perencanaan', 'aktif', 'ditunda', 'selesai']

// Swatches for projects and labels. All are light enough to carry indigo text (4.5:1 or more).
export const SWATCHES = ['#FFD23F', '#FF6B57', '#5DBDB0', '#8FA8F0', '#C3A6F0', '#F7A072', '#9ED36A', '#F49AC2']

export const TIMEZONES = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']

export interface TaskComment {
  id: string
  task_id: string
  author_id: string | null
  body: string
  created_at: string
}

export interface TaskLink {
  id: string
  task_id: string
  url: string
  label: string | null
  created_by: string | null
  created_at: string
}

export interface TaskAttachment {
  id: string
  task_id: string
  storage_path: string
  file_name: string
  size_bytes: number
  mime_type: string | null
  uploaded_by: string | null
  created_at: string
}

export interface ChecklistItem {
  id: string
  task_id: string
  title: string
  done: boolean
  position: number
  created_at: string
}
