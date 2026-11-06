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
  task_labels: { label_id: string }[]
}

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done', 'blocked']
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']
export const PROJECT_STATUSES: ProjectStatus[] = ['perencanaan', 'aktif', 'ditunda', 'selesai']

// Swatches for projects and labels. All are light enough to carry indigo text (4.5:1 or more).
export const SWATCHES = ['#FFD23F', '#FF6B57', '#5DBDB0', '#8FA8F0', '#C3A6F0', '#F7A072', '#9ED36A', '#F49AC2']

export const TIMEZONES = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']
