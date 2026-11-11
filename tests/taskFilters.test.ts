import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_FILTER,
  PRESETS,
  activeCount,
  compareTasks,
  endOfWeek,
  filterToQuery,
  matchesFilter,
  normalizeQuery,
  parseFilter,
  presetIsOn,
} from '../src/lib/taskFilters.ts'
import type { Task } from '../src/lib/types.ts'

function task(over: Partial<Task>): Task {
  return {
    id: 'a',
    project_id: 'p1',
    title: 'Desain banner',
    description: null,
    status: 'todo',
    priority: 'medium',
    start_date: null,
    deadline: '2026-11-12',
    assignee_id: 'u1',
    reviewer_id: null,
    created_by: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    blocked_from: null,
    review_note: null,
    review_note_by: null,
    review_note_at: null,
    task_labels: [],
    ...over,
  }
}

const ctx = { meId: 'u1', today: '2026-11-11' } // Wednesday

test('query round trip drops empty values and defaults', () => {
  assert.equal(filterToQuery(EMPTY_FILTER), '')
  const f = parseFilter(new URLSearchParams('q=banner&status=review&sort=priority&done=1&junk=1'))
  assert.equal(filterToQuery(f), 'q=banner&status=review&sort=priority&done=1')
  assert.equal(normalizeQuery('junk=1&priority=urgent&status=nope'), 'priority=urgent')
})

test('invalid dates and enums are ignored', () => {
  const f = parseFilter(new URLSearchParams('from=besok&due=never&priority=huge'))
  assert.equal(f.from, '')
  assert.equal(f.due, '')
  assert.equal(f.priority, '')
})

test('me resolves to the signed-in person', () => {
  const mine = parseFilter(new URLSearchParams('assignee=me'))
  assert.equal(matchesFilter(task({ assignee_id: 'u1' }), mine, ctx), true)
  assert.equal(matchesFilter(task({ assignee_id: 'u2' }), mine, ctx), false)
  assert.equal(matchesFilter(task({ assignee_id: null }), mine, { meId: undefined, today: ctx.today }), false)
})

test('search looks in title and description, ignoring case', () => {
  const f = { ...EMPTY_FILTER, q: ' BANNER ' }
  assert.equal(matchesFilter(task({}), f, ctx), true)
  assert.equal(matchesFilter(task({ title: 'Rapat', description: 'siapkan banner' }), f, ctx), true)
  assert.equal(matchesFilter(task({ title: 'Rapat' }), f, ctx), false)
})

test('deadline range is inclusive', () => {
  const f = { ...EMPTY_FILTER, from: '2026-11-12', to: '2026-11-14' }
  assert.equal(matchesFilter(task({ deadline: '2026-11-12' }), f, ctx), true)
  assert.equal(matchesFilter(task({ deadline: '2026-11-14' }), f, ctx), true)
  assert.equal(matchesFilter(task({ deadline: '2026-11-15' }), f, ctx), false)
  assert.equal(matchesFilter(task({ deadline: '2026-11-11' }), f, ctx), false)
})

test('label filter needs the label on the task', () => {
  const f = { ...EMPTY_FILTER, label: 'l1' }
  assert.equal(matchesFilter(task({ task_labels: [{ label_id: 'l1' }] }), f, ctx), true)
  assert.equal(matchesFilter(task({}), f, ctx), false)
})

test('overdue preset skips Done and tasks due today', () => {
  const f = { ...EMPTY_FILTER, due: 'overdue' as const }
  assert.equal(matchesFilter(task({ deadline: '2026-11-10' }), f, ctx), true)
  assert.equal(matchesFilter(task({ deadline: '2026-11-10', status: 'done' }), f, ctx), false)
  assert.equal(matchesFilter(task({ deadline: '2026-11-11' }), f, ctx), false)
})

test('this week runs from today to Sunday', () => {
  assert.equal(endOfWeek('2026-11-11'), '2026-11-15')
  assert.equal(endOfWeek('2026-11-15'), '2026-11-15')
  assert.equal(endOfWeek('2026-11-09'), '2026-11-15')
  const f = { ...EMPTY_FILTER, due: 'week' as const }
  assert.equal(matchesFilter(task({ deadline: '2026-11-15' }), f, ctx), true)
  assert.equal(matchesFilter(task({ deadline: '2026-11-16' }), f, ctx), false)
  assert.equal(matchesFilter(task({ deadline: '2026-11-10' }), f, ctx), false)
})

test('waiting-my-review preset needs review status and me as reviewer', () => {
  const review = PRESETS.find((p) => p.key === 'review')!
  const f = { ...EMPTY_FILTER, ...review.patch }
  assert.equal(presetIsOn(f, review), true)
  assert.equal(matchesFilter(task({ status: 'review', reviewer_id: 'u1' }), f, ctx), true)
  assert.equal(matchesFilter(task({ status: 'review', reviewer_id: 'u2' }), f, ctx), false)
  assert.equal(matchesFilter(task({ status: 'todo', reviewer_id: 'u1' }), f, ctx), false)
})

test('activeCount ignores search, sort and show-done', () => {
  assert.equal(activeCount({ ...EMPTY_FILTER, q: 'x', sort: 'title', done: true }), 0)
  assert.equal(activeCount({ ...EMPTY_FILTER, project: 'p', priority: 'high', from: '2026-11-01' }), 3)
})

test('sort orders', () => {
  const a = task({ id: 'a', title: 'b', priority: 'low', deadline: '2026-11-20', created_at: '2026-11-01T00:00:00Z' })
  const b = task({ id: 'b', title: 'A', priority: 'urgent', deadline: '2026-11-25', created_at: '2026-11-05T00:00:00Z' })
  const ids = (s: Parameters<typeof compareTasks>[0]) => [a, b].sort(compareTasks(s)).map((x) => x.id)
  assert.deepEqual(ids('deadline'), ['a', 'b'])
  assert.deepEqual(ids('priority'), ['b', 'a'])
  assert.deepEqual(ids('newest'), ['b', 'a'])
  assert.deepEqual(ids('title'), ['b', 'a'])
})
