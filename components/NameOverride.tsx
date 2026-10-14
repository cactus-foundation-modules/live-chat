'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/modules/chat/lib/constants'
import { BodyPortal, ChatStyles } from './ui'

// A config icon for the chat header. It opens a small modal where a colleague
// sets the name visitors see on their replies. Leave it empty to go back to
// the first name on their account.

type Loaded = { name: string; accountName: string | null }

export function NameOverrideButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" aria-label="Your name in chats" title="Your name in chats" onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open ? <NameModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function NameModal({ onClose }: { onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    fetch(`${API_BASE}/admin/profile`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: Loaded | null) => {
        if (!live) return
        if (json) { setLoaded(json); setName(json.name) } else setErr('Your name could not be loaded.')
      })
      .catch(() => { if (live) setErr('Your name could not be loaded.') })
    return () => { live = false }
  }, [])

  async function save() {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API_BASE}/admin/profile`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(json?.error ?? 'That name could not be saved.')
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That name could not be saved.')
      setBusy(false)
    }
  }

  return (
    <BodyPortal>
      <div className="cch-root">
        <ChatStyles />
        <div className="cch-modal-back" onClick={onClose}>
          <form
            className="cch-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cch-name-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
            onSubmit={(e) => { e.preventDefault(); void save() }}
          >
            <h3 id="cch-name-title">Your name in chats</h3>
            <p className="cch-muted">
              This is the name visitors see on your replies.
              {loaded?.accountName ? <> Leave it empty to use <strong>{loaded.accountName}</strong>, from your account.</> : ' Leave it empty to use the name on your account.'}
            </p>
            <input
              className="cch-input"
              autoFocus
              maxLength={40}
              value={name}
              placeholder={loaded?.accountName ?? 'Your name'}
              disabled={!loaded || busy}
              aria-label="Name shown to visitors"
              onChange={(e) => setName(e.target.value)}
            />
            {err ? <div className="cch-error" role="alert">{err}</div> : null}
            <div className="cch-row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="cch-btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="cch-btn primary" disabled={!loaded || busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      </div>
    </BodyPortal>
  )
}
