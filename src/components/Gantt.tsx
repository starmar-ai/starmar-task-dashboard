import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { useI18n } from '../lib/i18n'
import { addDays, daysBetween } from '../lib/dates'
import { DAY_WIDTH, buildScale, clampDelta, defaultZoom, dependencyClash, isWeekend, shiftDates, type Dates, type DragMode, type Zoom } from '../lib/gantt'
import type { Locale } from '../lib/types'

export interface GanttRow {
  id: string
  /** Name in the sticky left column. */
  label: string
  /** Small line under the name (project, "Menunggu: ..."). */
  sub?: string
  /** Extra chip under the name, e.g. how late the task is. */
  flag?: string
  /** Bar fill. Pass a CSS color, or leave out and give `tone` to use a status color from the stylesheet. */
  color?: string
  tone?: string
  glyph?: string
  /** Text inside the bar, only shown when the bar is wide enough. */
  barText?: string
  /** 0 to 1: share of the bar that is shaded as "done". */
  progress?: number
  start: string
  /** Last day, inclusive. */
  end: string
  /** True when the task has no start date: the bar is a one-day marker on its deadline. */
  noStart?: boolean
  editable?: boolean
  /** Spoken and tooltip text. */
  title: string
}

export interface GanttEdge {
  /** Row that must finish first. */
  from: string
  /** Row that waits for it. */
  to: string
}

interface Props {
  rows: GanttRow[]
  edges?: GanttEdge[]
  today: string
  onOpen: (id: string) => void
  /** Called once a drag ends on a new date. Nothing is saved here: the caller asks for confirmation first. */
  onChange?: (id: string, next: Dates) => void
  nameHeader: string
}

const ROW_H = 52
const HEAD_H = 60
const MONTH_H = 26
const BAR_H = 30
const ZOOMS: Zoom[] = ['day', 'week', 'month']

function fmt(iso: string, locale: Locale, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
}

interface DragState {
  id: string
  mode: DragMode
  delta: number
}

export function Gantt({ rows, edges = [], today, onOpen, onChange, nameHeader }: Props) {
  const { t, locale } = useI18n()
  const scale = useMemo(() => buildScale([...rows.map((r) => r.start), ...rows.map((r) => r.end)], today), [rows, today])
  const [zoom, setZoom] = useState<Zoom>(() => defaultZoom(scale.days))
  const dw = DAY_WIDTH[zoom]
  const width = scale.days * dw

  const [drag, setDrag] = useState<DragState | null>(null)
  const press = useRef<{ x: number; id: string; mode: DragMode; moved: boolean; pointer: number } | null>(null)
  const justDragged = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)

  const x = (iso: string) => daysBetween(scale.min, iso) * dw

  // Months for the top band and day marks for the second line.
  const months = useMemo(() => {
    const out: { key: string; left: number; width: number; label: string }[] = []
    let cursor = scale.min
    const last = addDays(scale.min, scale.days)
    while (cursor < last) {
      const first = cursor
      const monthKey = first.slice(0, 7)
      let next = first
      while (next < last && next.slice(0, 7) === monthKey) next = addDays(next, 1)
      out.push({
        key: monthKey,
        left: daysBetween(scale.min, first) * dw,
        width: daysBetween(first, next) * dw,
        label: fmt(first, locale, { month: 'long', year: 'numeric' }),
      })
      cursor = next
    }
    return out
  }, [scale, dw, locale])

  const ticks = useMemo(() => {
    if (zoom === 'month') return []
    const out: { iso: string; left: number; label: string; weekend: boolean }[] = []
    for (let i = 0; i < scale.days; i++) {
      const iso = addDays(scale.min, i)
      const monday = new Date(`${iso}T00:00:00Z`).getUTCDay() === 1
      if (zoom === 'week' && !monday) continue
      out.push({ iso, left: i * dw, label: String(Number(iso.slice(8))), weekend: isWeekend(iso) })
    }
    return out
  }, [scale, dw, zoom])

  const weekends = useMemo(() => {
    if (zoom === 'month') return []
    const out: number[] = []
    for (let i = 0; i < scale.days; i++) if (isWeekend(addDays(scale.min, i))) out.push(i * dw)
    return out
  }, [scale, dw, zoom])

  function current(row: GanttRow): Dates {
    const base: Dates = { start: row.noStart ? null : row.start, end: row.end }
    if (!drag || drag.id !== row.id) return base
    return shiftDates(base.start, base.end, drag.mode, drag.delta)
  }

  function onDown(e: PointerEvent<HTMLButtonElement>, row: GanttRow) {
    if (!row.editable || !onChange || e.button !== 0 || e.pointerType === 'touch') return
    const handle = (e.target as HTMLElement).dataset.handle as DragMode | undefined
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.clientX, id: row.id, mode: handle ?? 'move', moved: false, pointer: e.pointerId }
  }

  function onMove(e: PointerEvent<HTMLButtonElement>, row: GanttRow) {
    const p = press.current
    if (!p || p.id !== row.id) return
    const dx = e.clientX - p.x
    if (Math.abs(dx) > 4) p.moved = true
    if (!p.moved) return
    const base = row.noStart ? null : row.start
    setDrag({ id: row.id, mode: p.mode, delta: clampDelta(p.mode, base, row.end, Math.round(dx / dw)) })
  }

  function onUp(e: PointerEvent<HTMLButtonElement>, row: GanttRow) {
    const p = press.current
    press.current = null
    if (!p || p.id !== row.id) return
    if (e.currentTarget.hasPointerCapture(p.pointer)) e.currentTarget.releasePointerCapture(p.pointer)
    const delta = drag?.id === row.id ? drag.delta : 0
    setDrag(null)
    // A mouse press that did not move opens the task right here instead of waiting for `click`,
    // which some browsers skip after pointer capture. The click that follows is then ignored.
    justDragged.current = true
    setTimeout(() => (justDragged.current = false), 50)
    if (!p.moved) return onOpen(row.id)
    if (delta !== 0) onChange?.(row.id, shiftDates(row.noStart ? null : row.start, row.end, p.mode, delta))
  }

  function onCancel(row: GanttRow) {
    if (press.current?.id === row.id) press.current = null
    setDrag(null)
  }

  const index = new Map(rows.map((r, i) => [r.id, i]))
  const paths = edges.flatMap((edge) => {
    const a = index.get(edge.from)
    const b = index.get(edge.to)
    if (a === undefined || b === undefined) return []
    const from = rows[a]
    const to = rows[b]
    const x1 = x(addDays(from.end, 1))
    const x2 = x(to.start)
    const y1 = HEAD_H + a * ROW_H + ROW_H / 2
    const y2 = HEAD_H + b * ROW_H + ROW_H / 2
    const clash = dependencyClash(to.start, from.end)
    const lane = y2 > y1 ? ROW_H / 2 : -ROW_H / 2
    const d = clash
      ? `M${x1} ${y1} H${x1 + 8} V${y1 + lane} H${x2 - 10} V${y2} H${x2 - 1}`
      : `M${x1} ${y1} H${Math.min(x1 + 8, (x1 + x2) / 2)} V${y2} H${x2 - 1}`
    return [{ key: `${edge.from}-${edge.to}`, d, clash, tip: `M${x2} ${y2} l-7 -4.5 v9 z` }]
  })

  const todayX = x(today) + dw / 2
  const hasClash = paths.some((p) => p.clash)

  function jumpToToday() {
    scroller.current?.scrollTo({ left: Math.max(0, todayX - 260), behavior: 'smooth' })
  }

  return (
    <section className="gantt-wrap" aria-label={t('gantt.region')}>
      <div className="gantt-bar-tools">
        <fieldset className="segmented segmented-sm">
          <legend className="sr-only">{t('gantt.zoom')}</legend>
          {ZOOMS.map((z) => (
            <label key={z} className={zoom === z ? 'is-on' : ''}>
              <input type="radio" name="gantt-zoom" checked={zoom === z} onChange={() => setZoom(z)} />
              {t(`gantt.zoom.${z}`)}
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn btn-secondary btn-sm" onClick={jumpToToday}>
          {t('gantt.goToday')}
        </button>
        {onChange && <p className="muted small gantt-hint">{t('gantt.dragHint')}</p>}
      </div>

      <div className="gantt" ref={scroller} tabIndex={0} aria-label={t('gantt.scrollArea')}>
        <div className="gantt-inner" style={{ width: `calc(var(--g-label) + ${width}px)` }}>
          <div className="gantt-head" style={{ height: HEAD_H }}>
            <div className="gantt-corner">{nameHeader}</div>
            <div className="gantt-axis" style={{ width }}>
              {months.map((m) => (
                <div key={m.key} className="gantt-month" style={{ left: m.left, width: m.width, height: MONTH_H }}>
                  <span>{m.label}</span>
                </div>
              ))}
              {ticks.map((tk) => (
                <div key={tk.iso} className={`gantt-tick ${tk.weekend ? 'is-weekend' : ''}`} style={{ left: tk.left, top: MONTH_H, width: zoom === 'day' ? dw : undefined }}>
                  {tk.label}
                </div>
              ))}
              <div className="gantt-today-tag" style={{ left: todayX }}>
                {t('gantt.today')}
              </div>
            </div>
          </div>

          <div className="gantt-body" style={{ height: rows.length * ROW_H }}>
            <div className="gantt-under" style={{ width }} aria-hidden="true">
              {weekends.map((left) => (
                <i key={left} style={{ left, width: dw }} />
              ))}
            </div>
            {rows.map((row, i) => {
              const live = current(row)
              const start = live.start ?? live.end
              const left = x(start)
              const w = (daysBetween(start, live.end) + 1) * dw
              const dragging = drag?.id === row.id
              const showText = w > 70 && row.barText
              return (
                <div key={row.id} className="gantt-row" style={{ height: ROW_H, top: i * ROW_H }}>
                  <div className="gantt-name">
                    <button type="button" className="link-btn gantt-name-btn" onClick={() => onOpen(row.id)} title={row.label}>
                      {row.label}
                    </button>
                    {(row.sub || row.flag) && (
                      <span className="gantt-subline">
                        {row.flag && <span className="chip chip-overdue gantt-flag">{row.flag}</span>}
                        {row.sub && <span className="small muted gantt-sub">{row.sub}</span>}
                      </span>
                    )}
                  </div>
                  <div className="gantt-plot" style={{ width }}>
                    <button
                      type="button"
                      className={`gantt-task ${row.tone ? `gantt-tone-${row.tone}` : ''} ${row.editable && onChange ? 'is-editable' : ''} ${dragging ? 'is-dragging' : ''} ${row.noStart ? 'is-point' : ''}`}
                      style={{ left, width: w, height: BAR_H, background: row.color }}
                      aria-label={row.title}
                      title={row.title}
                      onClick={() => {
                        if (!justDragged.current) onOpen(row.id)
                      }}
                      onPointerDown={(e) => onDown(e, row)}
                      onPointerMove={(e) => onMove(e, row)}
                      onPointerUp={(e) => onUp(e, row)}
                      onPointerCancel={() => onCancel(row)}
                    >
                      {row.progress !== undefined && <span className="gantt-progress" style={{ width: `${Math.round(row.progress * 100)}%` }} aria-hidden="true" />}
                      {row.editable && onChange && !row.noStart && <span className="gantt-handle gantt-handle-start" data-handle="start" aria-hidden="true" />}
                      <span className="gantt-task-text" aria-hidden="true">
                        {row.glyph && <b>{row.glyph}</b>}
                        {showText && <span>{row.barText}</span>}
                      </span>
                      {row.editable && onChange && !row.noStart && <span className="gantt-handle gantt-handle-end" data-handle="end" aria-hidden="true" />}
                    </button>
                    {dragging && (
                      <span className="gantt-drag-tip" style={{ left: left + w + 8 }}>
                        {live.start ? `${fmt(live.start, locale, { day: 'numeric', month: 'short' })} – ` : ''}
                        {fmt(live.end, locale, { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="gantt-over" style={{ width, height: HEAD_H + rows.length * ROW_H }} aria-hidden="true">
            <svg width={width} height={HEAD_H + rows.length * ROW_H}>
              {paths.map((p) => (
                <g key={p.key} className={`gantt-edge ${p.clash ? 'is-clash' : ''}`}>
                  <path d={p.d} fill="none" />
                  <path d={p.tip} className="gantt-edge-tip" />
                </g>
              ))}
            </svg>
            <div className="gantt-today" style={{ left: todayX }} />
          </div>
        </div>
      </div>

      {edges.length > 0 && (
        <p className="muted small gantt-legend">
          {t('gantt.legendDeps')}
          {hasClash && ` ${t('gantt.legendClash')}`}
        </p>
      )}
    </section>
  )
}
