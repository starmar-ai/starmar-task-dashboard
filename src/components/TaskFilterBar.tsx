import { useState, type FormEvent } from 'react'
import { errorMessage, useI18n } from '../lib/i18n'
import { useSavedFilters, type SavedFilter } from '../lib/savedFilters'
import {
  ME,
  PRESETS,
  SORTS,
  activeCount,
  filterToQuery,
  isFiltered,
  normalizeQuery,
  presetIsOn,
  type TaskFilter,
} from '../lib/taskFilters'
import { PRIORITIES, TASK_STATUSES, type Label, type Profile } from '../lib/types'
import { ConfirmDialog, Modal } from './Modal'

interface Props {
  filter: TaskFilter
  onChange: (patch: Partial<TaskFilter>) => void
  /** Replace the whole filter with the one stored in a query string. */
  onApply: (query: string) => void
  onReset: () => void
  people: Profile[]
  labels: Label[]
}

export function TaskFilterBar({ filter, onChange, onApply, onReset, people, labels }: Props) {
  const { t } = useI18n()
  const count = activeCount(filter)
  const [open, setOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const saved = useSavedFilters()
  const [naming, setNaming] = useState(false)
  const savedHidden = saved.error?.code === '42P01' || saved.error?.code === '42501' || /saved_filters/.test(saved.error?.message ?? '')
  const alreadySaved = saved.filters.some((f) => normalizeQuery(f.query) === filterToQuery(filter))

  function applyPreset(key: (typeof PRESETS)[number]['key']) {
    const preset = PRESETS.find((p) => p.key === key)!
    if (presetIsOn(filter, preset)) {
      const cleared: Partial<TaskFilter> = {}
      for (const k of Object.keys(preset.patch) as (keyof TaskFilter)[]) (cleared as Record<string, unknown>)[k] = ''
      onChange(cleared)
    } else {
      // A preset starts from a clean slate on the fields it does not own, so two presets never fight.
      onChange({ assignee: '', reviewer: '', status: '', due: '', from: '', to: '', ...preset.patch })
    }
  }

  const personOptions = (
    <>
      <option value="">{t('filter.all')}</option>
      <option value={ME}>{t('filter.me')}</option>
      {people
        .filter((p) => p.active)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name || p.email}
          </option>
        ))}
    </>
  )

  return (
    <section className="filter-bar" aria-label={t('filter.region')}>
      <div className="filter-main">
        <div className="field filter-search">
          <label htmlFor="filter-q" className="sr-only">
            {t('filter.search')}
          </label>
          <input
            id="filter-q"
            type="search"
            value={filter.q}
            placeholder={`${t('filter.search')}: ${t('filter.searchPlaceholder').toLowerCase()}`}
            onChange={(e) => onChange({ q: e.target.value })}
          />
        </div>
        <div className="filter-tools">
          <button type="button" className="tool-btn" aria-label={t('filter.sortOpen')} title={t('filter.sortOpen')} aria-expanded={sortOpen} aria-controls="filter-sort-panel" onClick={() => setSortOpen((v) => !v)}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 5v14M4.5 15.5L8 19l3.5-3.5M16 19V5M12.5 8.5L16 5l3.5 3.5" />
            </svg>
          </button>
          <button type="button" className="tool-btn" aria-label={count > 0 ? t('filter.moreCount', { n: count }) : t('filter.filterOpen')} title={t('filter.filterOpen')} aria-expanded={open} aria-controls="filter-advanced" onClick={() => setOpen((v) => !v)}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {count > 0 && (
              <span className="tool-count" aria-hidden="true">
                {count}
              </span>
            )}
          </button>
        </div>
      </div>

      {sortOpen && (
        <div id="filter-sort-panel" className="field filter-sort-panel">
          <label htmlFor="filter-sort">{t('filter.sort')}</label>
          <select id="filter-sort" value={filter.sort} onChange={(e) => onChange({ sort: e.target.value as TaskFilter['sort'] })}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}`)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="chip-row filter-presets" role="group" aria-label={t('filter.presets')}>
        {PRESETS.map((preset) => {
          const on = presetIsOn(filter, preset)
          return (
            <button key={preset.key} type="button" className={`pill-btn ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => applyPreset(preset.key)}>
              {t(`preset.${preset.key}`)}
            </button>
          )
        })}
        <button type="button" className="text-link" aria-expanded={open} aria-controls="filter-advanced" onClick={() => setOpen((v) => !v)}>
          {count > 0 ? t('filter.moreCount', { n: count }) : t('filter.more')}
        </button>
        {isFiltered(filter) && (
          <button type="button" className="text-link" onClick={onReset}>
            {t('filter.reset')}
          </button>
        )}
        {isFiltered(filter) && !alreadySaved && !savedHidden && (
          <button type="button" className="text-link" onClick={() => setNaming(true)}>
            {t('saved.saveCurrent')}
          </button>
        )}
      </div>

      {open && (
        <div id="filter-advanced" className="filter-grid">
          <div className="field">
            <label htmlFor="filter-assignee">{t('filter.assignee')}</label>
            <select id="filter-assignee" value={filter.assignee} onChange={(e) => onChange({ assignee: e.target.value })}>
              {personOptions}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-reviewer">{t('filter.reviewer')}</label>
            <select id="filter-reviewer" value={filter.reviewer} onChange={(e) => onChange({ reviewer: e.target.value })}>
              {personOptions}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-status">{t('filter.status')}</label>
            <select id="filter-status" value={filter.status} onChange={(e) => onChange({ status: e.target.value as TaskFilter['status'] })}>
              <option value="">{t('filter.all')}</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-priority">{t('filter.priority')}</label>
            <select id="filter-priority" value={filter.priority} onChange={(e) => onChange({ priority: e.target.value as TaskFilter['priority'] })}>
              <option value="">{t('filter.all')}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-label">{t('filter.label')}</label>
            <select id="filter-label" value={filter.label} onChange={(e) => onChange({ label: e.target.value })}>
              <option value="">{t('filter.all')}</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-due">{t('filter.due')}</label>
            <select id="filter-due" value={filter.due} onChange={(e) => onChange({ due: e.target.value as TaskFilter['due'] })}>
              <option value="">{t('filter.all')}</option>
              <option value="overdue">{t('preset.overdue')}</option>
              <option value="week">{t('preset.week')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-from">{t('filter.from')}</label>
            <input id="filter-from" type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => onChange({ from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="filter-to">{t('filter.to')}</label>
            <input id="filter-to" type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => onChange({ to: e.target.value })} />
          </div>
        </div>
      )}

      <SavedFilters filter={filter} onApply={onApply} saved={saved} naming={naming} setNaming={setNaming} />
    </section>
  )
}

function SavedFilters({
  filter,
  onApply,
  saved,
  naming,
  setNaming,
}: {
  filter: TaskFilter
  onApply: (query: string) => void
  saved: ReturnType<typeof useSavedFilters>
  naming: boolean
  setNaming: (v: boolean) => void
}) {
  const { t } = useI18n()
  const [renaming, setRenaming] = useState<SavedFilter | null>(null)
  const [deleting, setDeleting] = useState<SavedFilter | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const current = filterToQuery(filter)
  const activeSaved = saved.filters.find((f) => normalizeQuery(f.query) === current)
  const tableMissing = saved.error?.code === '42P01' || saved.error?.code === '42501' || /saved_filters/.test(saved.error?.message ?? '')

  function fail(err: { message?: string; code?: string }) {
    setActionError(err.code === '23505' ? t('saved.duplicate') : errorMessage(t, err))
  }

  async function confirmDelete() {
    if (!deleting) return
    const err = await saved.remove(deleting.id)
    if (err) fail(err)
    else setActionError(null)
    setDeleting(null)
  }

  return (
    <div className="saved-filters">
      {tableMissing ? (
        <p className="muted small">{t('saved.setup')}</p>
      ) : (
        <>
          {saved.filters.length > 0 && (
            <>
              <h2 className="saved-title">{t('saved.title')}</h2>
              <ul className="saved-list">
              {saved.filters.map((f) => (
                <li key={f.id} className={`saved-item ${activeSaved?.id === f.id ? 'is-on' : ''}`}>
                  <button type="button" className="saved-apply" aria-pressed={activeSaved?.id === f.id} onClick={() => onApply(f.query)}>
                    {f.name}
                  </button>
                  <button type="button" className="saved-act" onClick={() => setRenaming(f)} aria-label={t('saved.renameFor', { name: f.name })}>
                    {t('saved.rename')}
                  </button>
                  <button type="button" className="saved-act" onClick={() => setDeleting(f)} aria-label={t('saved.deleteFor', { name: f.name })}>
                    {t('common.delete')}
                  </button>
                </li>
              ))}
              </ul>
            </>
          )}
        </>
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {naming && (
        <NameDialog
          title={t('saved.saveCurrent')}
          initial=""
          onClose={() => setNaming(false)}
          onSubmit={async (name) => {
            const err = await saved.save(name, current)
            if (!err) setActionError(null)
            return err
          }}
        />
      )}
      {renaming && (
        <NameDialog
          title={t('saved.rename')}
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            const err = await saved.rename(renaming.id, name)
            if (!err) setActionError(null)
            return err
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('saved.deleteTitle')}
          message={t('saved.deleteConfirm', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function NameDialog({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string
  initial: string
  onClose: () => void
  onSubmit: (name: string) => Promise<{ message?: string; code?: string } | null>
}) {
  const { t } = useI18n()
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError(t('saved.nameRequired'))
    setBusy(true)
    const err = await onSubmit(name)
    setBusy(false)
    if (err) setError(err.code === '23505' ? t('saved.duplicate') : errorMessage(t, err))
    else onClose()
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="saved-name-form" className="btn btn-primary" disabled={busy}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="saved-name-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="saved-name">{t('saved.name')}</label>
          <input id="saved-name" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t('saved.namePlaceholder')} />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
