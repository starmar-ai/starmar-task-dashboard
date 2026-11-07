import { addDays, daysBetween } from './dates.ts'

export type Zoom = 'day' | 'week' | 'month'
export type DragMode = 'move' | 'start' | 'end'

/** Pixels per day at each zoom level. */
export const DAY_WIDTH: Record<Zoom, number> = { day: 36, week: 16, month: 6 }

export interface Scale {
  /** First day on the axis, YYYY-MM-DD. */
  min: string
  days: number
}

/** Axis that fits every date and today, with weeks of empty room on both sides so the chart can always be scrolled and planned further out. */
export function buildScale(dates: string[], today: string): Scale {
  const all = [...dates, today]
  const lo = all.reduce((a, b) => (b < a ? b : a))
  const hi = all.reduce((a, b) => (b > a ? b : a))
  const min = addDays(lo, -14)
  return { min, days: daysBetween(min, addDays(hi, 45)) + 1 }
}

export function defaultZoom(days: number): Zoom {
  if (days <= 75) return 'day'
  if (days <= 240) return 'week'
  return 'month'
}

/** How many days a drag may move: the start can't pass the end, and the end can't pass the start. */
export function clampDelta(mode: DragMode, start: string | null, end: string, delta: number): number {
  const length = start ? daysBetween(start, end) : 0
  if (mode === 'start') return Math.min(delta, length)
  if (mode === 'end') return Math.max(delta, -length)
  return delta
}

export interface Dates {
  start: string | null
  end: string
}

/** Dates after a drag. A task without a start date only moves as a whole (its deadline shifts). */
export function shiftDates(start: string | null, end: string, mode: DragMode, delta: number): Dates {
  const d = clampDelta(mode, start, end, delta)
  if (mode === 'move') return { start: start ? addDays(start, d) : null, end: addDays(end, d) }
  if (mode === 'start') return { start: start ? addDays(start, d) : null, end }
  return { start, end: addDays(end, d) }
}

export function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

/** A task that must finish first starts after its dependent already begins: shown in a different line style, never auto-fixed. */
export function dependencyClash(waitingStart: string, mustFinishFirstEnd: string): boolean {
  return waitingStart <= mustFinishFirstEnd
}
