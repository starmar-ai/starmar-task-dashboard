import { useEffect } from 'react'

const EVENT = 'starmar:requests-changed'

/** Tell the sidebar badge and open pages that a change request was sent or decided. */
export function emitRequestsChanged() {
  window.dispatchEvent(new Event(EVENT))
}

export function useRequestsChanged(reload: () => void) {
  useEffect(() => {
    window.addEventListener(EVENT, reload)
    return () => window.removeEventListener(EVENT, reload)
  }, [reload])
}
