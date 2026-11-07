import { addDays } from './dates.ts'

/** First day of the month containing iso, YYYY-MM-DD. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/** First day of the month that is `n` months after the month of iso (negative goes back). */
export function shiftMonth(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7)) - 1 + n
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}

/** Days shown for a month: whole weeks starting on Monday, so 35 or 42 dates. */
export function monthGrid(iso: string): string[] {
  const first = monthStart(iso)
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  const start = addDays(first, -weekday)
  const next = shiftMonth(first, 1)
  const last = addDays(next, -1)
  const lastWeekday = (new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7
  const end = addDays(last, 6 - lastWeekday)
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

/** Groups items by their date (via `dateOf`), keeping input order inside each day. */
export function groupByDate<T>(items: T[], dateOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = dateOf(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return map
}
