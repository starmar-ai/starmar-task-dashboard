export interface ChecklistProgress {
  done: number
  total: number
  /** 0 to 100, rounded. 0 when there are no items. */
  pct: number
}

export function checklistProgress(items: { done: boolean }[] | undefined | null): ChecklistProgress | null {
  if (!items || items.length === 0) return null
  const done = items.filter((i) => i.done).length
  return { done, total: items.length, pct: Math.round((done / items.length) * 100) }
}

/** Position for a new item: after the last one. */
export function nextPosition(items: { position: number }[]): number {
  return items.reduce((max, i) => Math.max(max, i.position), 0) + 1
}

/** Move the item at `index` one step up (-1) or down (1). Returns the new order, or the same array if it cannot move. */
export function moveItem<T>(items: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir
  if (to < 0 || to >= items.length) return items
  const next = items.slice()
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}
