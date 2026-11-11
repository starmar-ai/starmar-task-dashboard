/** Keyboard shortcuts. Pure helpers so the key logic can be tested without a browser. */

export type ShortcutAction =
  | { kind: 'search' }
  | { kind: 'help' }
  | { kind: 'newTask' }
  | { kind: 'toggleTheme' }
  | { kind: 'go'; path: string }
  | { kind: 'startGo' }

/** "G" then a letter: the letter follows the page's English name so it stays the same in both languages. */
export const GO_KEYS: { key: string; path: string; nav: string }[] = [
  { key: 'd', path: '/dashboard', nav: 'nav.dashboard' },
  { key: 't', path: '/tasks', nav: 'nav.tasks' },
  { key: 'p', path: '/projects', nav: 'nav.projects' },
  { key: 'c', path: '/calendar', nav: 'nav.calendar' },
  { key: 'w', path: '/workload', nav: 'nav.workload' },
  { key: 'r', path: '/requests', nav: 'nav.requests' },
  { key: 'n', path: '/notifications', nav: 'nav.notifications' },
  { key: 's', path: '/settings', nav: 'nav.settings' },
]

/** How long "G" waits for the second key. */
export const GO_TIMEOUT_MS = 1500

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  repeat?: boolean
}

export interface KeyContext {
  /** Focus is in a text field, select, or editable area. */
  typing: boolean
  /** A dialog or the quick-add panel is open: only Ctrl/Cmd+K still works there. */
  overlayOpen: boolean
  /** "G" was pressed a moment ago. */
  awaitingGo: boolean
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el as HTMLElement).tagName) return false
  const node = el as HTMLElement
  const tag = node.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable) return true
  if (tag !== 'INPUT') return false
  const type = (node as HTMLInputElement).type
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type)
}

export function shortcutFor(e: KeyLike, ctx: KeyContext): ShortcutAction | null {
  if (e.repeat) return null
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') return ctx.overlayOpen ? null : { kind: 'search' }
  if (e.ctrlKey || e.metaKey || e.altKey || ctx.typing || ctx.overlayOpen) return null

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (ctx.awaitingGo) {
    const hit = GO_KEYS.find((g) => g.key === key)
    return hit ? { kind: 'go', path: hit.path } : null
  }
  if (e.key === '?') return { kind: 'help' }
  if (e.key === '/') return { kind: 'search' }
  if (key === 'n') return { kind: 'newTask' }
  if (key === 't') return { kind: 'toggleTheme' }
  if (key === 'g') return { kind: 'startGo' }
  return null
}

export const HELP_EVENT = 'starmar:shortcut-help'

/** Lets a page (Settings) open the shortcut list that lives in the app shell. */
export function openShortcutHelp() {
  window.dispatchEvent(new Event(HELP_EVENT))
}
