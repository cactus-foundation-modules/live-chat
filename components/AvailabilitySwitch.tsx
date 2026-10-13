'use client'

import { useCallback, useEffect, useState } from 'react'
import { API_BASE } from '@/modules/chat/lib/constants'

// The Online/Offline switch for whoever answers chats. Site-wide: offline tells
// visitors nobody is about (the widget still takes a message). It re-reads now
// and then so a colleague flipping it elsewhere shows up here too.

export function useAvailability() {
  const [online, setOnline] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    const read = () => fetch(`${API_BASE}/admin/availability`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { online: boolean } | null) => { if (live && json) setOnline(json.online) })
      .catch(() => { /* next round */ })
    void read()
    const timer = setInterval(() => { if (!document.hidden) void read() }, 60_000)
    return () => { live = false; clearInterval(timer) }
  }, [])

  const change = useCallback(async (next: boolean) => {
    setBusy(true)
    const before = online
    setOnline(next)
    try {
      const res = await fetch(`${API_BASE}/admin/availability`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ online: next }),
      })
      if (!res.ok) setOnline(before)
    } catch {
      setOnline(before)
    } finally {
      setBusy(false)
    }
  }, [online])

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
