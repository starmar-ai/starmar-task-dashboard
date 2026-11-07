import { useEffect } from 'react'

const EVENT = 'starmar:tasks-changed'

/** Tell open pages that tasks were added, restored or removed somewhere else (the floating add button, Trash). */
export function emitTasksChanged() {
  window.dispatchEvent(new Event(EVENT))
}

export function useTasksChanged(reload: () => void) {
  useEffect(() => {
    window.addEventListener(EVENT, reload)
    return () => window.removeEventListener(EVENT, reload)
  }, [reload])
}
