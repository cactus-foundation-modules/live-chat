'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { API_BASE } from '@/modules/chat/lib/constants'
import { availabilityFromServer, nudgeAdmin, publishAvailability, readAvailability, subscribeAvailability } from './live'

// The Online/Offline switch for whoever answers chats. Site-wide: offline tells
// visitors nobody is about (the widget still takes a message). Every switch on
// the page shares one value, which the chat list refreshes on each of its polls,
// so a colleague flipping it elsewhere shows up here within seconds.

export function useAvailability() {
  const online = useSyncExternalStore(subscribeAvailability, readAvailability, () => null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (readAvailability() !== null) return
    let live = true
    fetch(`${API_BASE}/admin/availability`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { online: boolean } | null) => { if (live && json && readAvailability() === null) availabilityFromServer(json.online) })
      .catch(() => { /* the chat list brings it soon enough */ })
    return () => { live = false }
  }, [])

  const change = useCallback(async (next: boolean) => {
    setBusy(true)
    const before = readAvailability()
    publishAvailability(next, 5_000)
    try {
      const res = await fetch(`${API_BASE}/admin/availability`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ online: next }),
      })
      if (!res.ok) publishAvailability(before)
      else nudgeAdmin()
    } catch {
      publishAvailability(before)
    } finally {
      setBusy(false)
    }
  }, [])

  return { online, busy, change }
}

export function AvailabilitySwitch({ online, busy, onChange, onDark }: {
  online: boolean | null
  busy: boolean
  onChange: (next: boolean) => void
  /** On the coloured header of the bubble, where the pill borrows its colours. */
  onDark?: boolean
}) {
  if (online === null) return null
  return (
    <button
      type="button"
      className={`cch-avail${online ? ' on' : ''}${onDark ? ' dark' : ''}`}
      role="switch"
      aria-checked={online}
      disabled={busy}
      title={online ? 'Visitors see that you are online. Click to go offline.' : 'Visitors see that you are away. Click to go online.'}
      onClick={() => onChange(!online)}
    >
      <span className="cch-avail-dot" aria-hidden="true" />
      {online ? 'Online' : 'Offline'}
    </button>
  )
}
