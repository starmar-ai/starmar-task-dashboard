import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { formatDate } from '../lib/dates'
import type { Task } from '../lib/types'
import { StatusChip } from './Chips'
import { Modal } from './Modal'

type Hit = Pick<Task, 'id' | 'title' | 'status' | 'deadline'>

const MAX_HITS = 8

/** True when the key press should open quick search: "/" or Ctrl/Cmd+K, but never while typing in a field. */
export function isSearchShortcut(e: globalThis.KeyboardEvent): boolean {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') return true
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return false
  const el = e.target as HTMLElement | null
  if (!el) return true
  const tag = el.tagName
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable)
}

export function QuickSearch({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<Hit[]>([])
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    let alive = true
    supabase
      .from('tasks')
      .select('id,title,status,deadline')
      .order('deadline')
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setFailed(true)
        else setTasks(data as Hit[])
      })
    return () => {
      alive = false
    }
  }, [])

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    return tasks.filter((x) => x.title.toLowerCase().includes(needle)).slice(0, MAX_HITS)
  }, [tasks, q])

  function go(path: string) {
    onClose()
    navigate(path)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (hits[active]) go(`/tasks?open=${hits[active].id}`)
      else if (q.trim()) go(`/tasks?q=${encodeURIComponent(q.trim())}`)
    }
  }

  return (
    <Modal title={t('qs.title')} onClose={onClose}>
      <div className="field">
        <label htmlFor="qs-input">{t('qs.title')}</label>
        <input
          id="qs-input"
          type="search"
          autoFocus
          autoComplete="off"
          value={q}
          placeholder={t('qs.placeholder')}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {failed && (
        <p className="form-error" role="alert">
          {t('qs.loadError')}
        </p>
      )}
      {q.trim() && !failed && hits.length === 0 && <p className="muted">{t('qs.none')}</p>}
      {hits.length > 0 && (
        <ul className="qs-results">
          {hits.map((h, i) => (
            <li key={h.id}>
              <button type="button" className={`qs-item ${i === active ? 'is-active' : ''}`} onClick={() => go(`/tasks?open=${h.id}`)} onMouseEnter={() => setActive(i)}>
                <span className="qs-title">{h.title}</span>
                <StatusChip status={h.status} />
                <span className="muted small">{formatDate(h.deadline, locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && (
        <p>
          <button type="button" className="link-btn" onClick={() => go(`/tasks?q=${encodeURIComponent(q.trim())}`)}>
            {t('qs.seeAll')}
          </button>
        </p>
      )}
      <p className="muted small">{t('qs.hint')}</p>
    </Modal>
  )
}
