import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export type SectionTone = 'teal' | 'yellow' | 'periwinkle' | 'coral' | 'neutral'

export interface SectionDef {
  key: string
  label: string
  /** Short badge text next to the title ("2/5", "3"). Empty hides the badge. */
  badge?: string
  tone: SectionTone
  /** Small dot on the tab: something here deserves a look. */
  flag?: boolean
  flagLabel?: string
  content: ReactNode
}

export interface TaskCounts {
  checklistDone: number
  checklistTotal: number
  waiting: number
  files: number
  comments: number
  newComment: boolean
  requestsPending: number
  requestsTotal: number
}

const EMPTY: TaskCounts = {
  checklistDone: 0,
  checklistTotal: 0,
  waiting: 0,
  files: 0,
  comments: 0,
  newComment: false,
  requestsPending: 0,
  requestsTotal: 0,
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Cheap head/count queries so tabs can show numbers before (and without) opening each section. */
export function useTaskCounts(taskId: string, myId: string | undefined, enabled: boolean) {
  const [counts, setCounts] = useState<TaskCounts>(EMPTY)

  const reload = useCallback(async () => {
    if (!enabled || !taskId) return
    const [list, deps, links, atts, comments, reqs] = await Promise.all([
      supabase.from('task_checklist_items').select('done').eq('task_id', taskId),
      supabase.from('task_dependencies').select('depends_on_id').eq('task_id', taskId),
      supabase.from('task_links').select('id', { count: 'exact', head: true }).eq('task_id', taskId),
      supabase.from('task_attachments').select('id', { count: 'exact', head: true }).eq('task_id', taskId),
      supabase.from('task_comments').select('author_id, created_at').eq('task_id', taskId).order('created_at', { ascending: false }),
      supabase.from('change_requests').select('status').eq('task_id', taskId),
    ])
    const items = (list.data ?? []) as { done: boolean }[]
    const blockers = ((deps.data ?? []) as { depends_on_id: string }[]).map((d) => d.depends_on_id)
    let waiting = 0
    if (blockers.length) {
      const { data } = await supabase.from('tasks').select('id, status').in('id', blockers)
      waiting = ((data ?? []) as { status: string }[]).filter((x) => x.status !== 'done').length
    }
    const cs = (comments.data ?? []) as { author_id: string | null; created_at: string }[]
    const latestOther = cs.find((c) => c.author_id !== myId)
    const reqRows = (reqs.data ?? []) as { status: string }[]
    setCounts({
      checklistDone: items.filter((i) => i.done).length,
      checklistTotal: items.length,
      waiting,
      files: (links.count ?? 0) + (atts.count ?? 0),
      comments: cs.length,
      // "New" = someone else wrote in the last 24 hours. There is no read-tracking, so this is a hint, not a read receipt.
      newComment: !!latestOther && Date.now() - new Date(latestOther.created_at).getTime() < DAY_MS,
      requestsPending: reqRows.filter((r) => r.status === 'pending').length,
      requestsTotal: reqRows.length,
    })
  }, [taskId, myId, enabled])

  useEffect(() => {
    reload()
  }, [reload])

  return { counts, reload }
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

interface Props {
  sections: SectionDef[]
  /** Desktop: tabs beside the form. Otherwise: stacked, collapsible cards. */
  wide: boolean
  defaultKey?: string
  /** Called (debounced) after the user touched anything inside a section, so badge numbers stay fresh. */
  onTouched: () => void
  /** Called when a section is opened, so "new" dots can clear. */
  onOpened?: (key: string) => void
}

/** Every section stays mounted (state and drafts survive switching); only visibility changes. */
export function TaskSections({ sections, wide, defaultKey, onTouched, onOpened }: Props) {
  const { t } = useI18n()
  const [active, setActive] = useState(defaultKey ?? sections[0]?.key)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const touched = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(onTouched, 700)
  }

  // A conditional section (change requests) can disappear while it is the active tab.
  const activeKey = sections.some((s) => s.key === active) ? active : sections[0]?.key

  function select(key: string) {
    setActive(key)
    onOpened?.(key)
  }

  function toggle(key: string) {
    const next = !open[key]
    setOpen((o) => ({ ...o, [key]: next }))
    if (next) onOpened?.(key)
  }

  if (wide) {
    return (
      <div className="tf-tabs" onClickCapture={touched} onChangeCapture={touched} onSubmitCapture={touched}>
        <div className="tf-tablist" role="tablist" aria-label={t('taskSections.label')}>
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              id={`tf-tab-${s.key}`}
              aria-selected={s.key === activeKey}
              aria-controls={`tf-panel-${s.key}`}
              tabIndex={s.key === activeKey ? 0 : -1}
              className={`tf-tab tf-tone-${s.tone}`}
              onClick={() => select(s.key)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                e.preventDefault()
                const i = sections.findIndex((x) => x.key === activeKey)
                const next = sections[(i + (e.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length]
                select(next.key)
                document.getElementById(`tf-tab-${next.key}`)?.focus()
              }}
            >
              <span>{s.label}</span>
              {s.badge ? <span className="tf-badge">{s.badge}</span> : null}
              {s.flag && (
                <span className="tf-dot" role="img" aria-label={s.flagLabel} title={s.flagLabel} />
              )}
            </button>
          ))}
        </div>
        {sections.map((s) => (
          <div
            key={s.key}
            role="tabpanel"
            id={`tf-panel-${s.key}`}
            aria-labelledby={`tf-tab-${s.key}`}
            className={`tf-panel tf-tone-${s.tone}`}
            hidden={s.key !== activeKey}
          >
            {s.content}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="tf-stack" onClickCapture={touched} onChangeCapture={touched} onSubmitCapture={touched}>
      {sections.map((s) => {
        const isOpen = !!open[s.key]
        return (
          <section key={s.key} className={`tf-card tf-tone-${s.tone} ${isOpen ? 'is-open' : ''}`}>
            <h3 className="tf-card-title">
              <button
                type="button"
                className="tf-card-toggle"
                aria-expanded={isOpen}
                aria-controls={`tf-panel-${s.key}`}
                onClick={() => toggle(s.key)}
              >
                <span className="tf-card-name">{s.label}</span>
                {s.badge ? <span className="tf-badge">{s.badge}</span> : null}
                {s.flag && <span className="tf-dot" role="img" aria-label={s.flagLabel} />}
                <svg className="tf-chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </h3>
            <div id={`tf-panel-${s.key}`} className="tf-card-body" hidden={!isOpen}>
              {s.content}
            </div>
          </section>
        )
      })}
    </div>
  )
}
