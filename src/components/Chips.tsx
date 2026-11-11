import { useI18n } from '../lib/i18n'
import type { Priority, ProjectStatus, TaskStatus } from '../lib/types'
import { checklistProgress } from '../lib/checklist'

// Each chip pairs a shape glyph with text, so status never relies on color alone.
export const STATUS_GLYPH: Record<TaskStatus, string> = {
  todo: '○',
  in_progress: '◐',
  review: '◎',
  done: '✓',
  blocked: '■',
}

export function StatusChip({ status }: { status: TaskStatus }) {
  const { t } = useI18n()
  return (
    <span className={`chip chip-status-${status}`}>
      <span aria-hidden="true" className="chip-glyph">
        {STATUS_GLYPH[status]}
      </span>
      {t(`status.${status}`)}
    </span>
  )
}

const PRIORITY_BARS: Record<Priority, number> = { low: 1, medium: 2, high: 3, urgent: 4 }

export function PriorityChip({ priority }: { priority: Priority }) {
  const { t } = useI18n()
  const n = PRIORITY_BARS[priority]
  return (
    <span className={`chip chip-priority-${priority}`}>
      <span className="bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= n ? 'on' : ''} />
        ))}
      </span>
      {t(`priority.${priority}`)}
    </span>
  )
}

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  const { t } = useI18n()
  return <span className={`chip chip-pstatus-${status}`}>{t(`pstatus.${status}`)}</span>
}

export function RiskChip() {
  const { t } = useI18n()
  return (
    <span className="chip chip-risk">
      <span aria-hidden="true" className="chip-glyph">
        !
      </span>
      {t('projects.atRisk')}
    </span>
  )
}

export function ProjectName({ name, color }: { name: string; color: string }) {
  return (
    <span className="project-name">
      <span className="swatch" style={{ background: color }} aria-hidden="true" />
      <span>{name}</span>
    </span>
  )
}

export function LabelTag({ name, color }: { name: string; color: string }) {
  return (
    <span className="label-tag" style={{ background: color }}>
      {name}
    </span>
  )
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <span className="avatar" aria-hidden="true">
      {initials || '?'}
    </span>
  )
}

/** Small "2/5" with a thin bar. Renders nothing for a task without checklist items. */
export function ChecklistBadge({ items }: { items: { done: boolean }[] | undefined }) {
  const { t } = useI18n()
  const p = checklistProgress(items)
  if (!p) return null
  return (
    <span className="check-badge" title={t('checklist.progress', { done: p.done, total: p.total })}>
      <span className="check-badge-bar" aria-hidden="true">
        <span style={{ width: `${p.pct}%` }} />
      </span>
      <span className="small">
        <span className="sr-only">{t('checklist.title')} </span>
        {p.done}/{p.total}
      </span>
    </span>
  )
}
