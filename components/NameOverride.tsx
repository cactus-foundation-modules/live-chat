'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/modules/chat/lib/constants'
import { BodyPortal, ChatStyles } from './ui'

// A config icon for the chat header. It opens a small modal with the two things
// that are a colleague's own business: the name visitors see on their replies
// (empty goes back to the first name on their account), and whether live chat
// tells them about things on the site, in the browser, both or neither.
//
// The notification switches are the same choices as Settings > Notifications,
// stored in the same place, so changing one here changes it there too.

type Loaded = { name: string; accountName: string | null }
type Pref = { show: boolean; browser: boolean }
type Kind = { id: string; label: string; description: string; pref: Pref }

/** The visitor-arrived kind never sits in the bell - it is a browser alert or
 *  nothing - so it gets one switch rather than two. */
function browserOnly(kind: Kind): boolean {
  return kind.id.endsWith(':visitor-arrived')
}

export function NameOverrideButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" aria-label="Your chat settings" title="Your chat settings" onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open ? <SettingsModal onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [name, setName] = useState('')
  const [kinds, setKinds] = useState<Kind[] | null>(null)
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
    // Its own request, and allowed to fail on its own: the name still works
    // without it, and the section simply is not drawn.
    fetch(`${API_BASE}/admin/notifications`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { kinds: Kind[] } | null) => { if (live && json) setKinds(json.kinds) })
      .catch(() => undefined)
    return () => { live = false }
  }, [])

  function setPref(id: string, next: Pref) {
    setKinds((prev) => prev?.map((k) => (k.id === id ? { ...k, pref: next } : k)) ?? null)
  }

  async function save() {
    setBusy(true)
    setErr('')
    try {
      const saves: Promise<Response>[] = [
        fetch(`${API_BASE}/admin/profile`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      ]
      if (kinds) {
        saves.push(fetch(`${API_BASE}/admin/notifications`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(kinds.map((k) => [k.id, k.pref]))),
        }))
      }
      for (const res of await Promise.all(saves)) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(json?.error ?? 'Your settings could not be saved.')
      }
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Your settings could not be saved.')
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
            <h3 id="cch-name-title">Your chat settings</h3>
            <label className="cch-field-label" htmlFor="cch-agent-name">Your name in chats</label>
            <p className="cch-muted">
              This is the name visitors see on your replies.
              {loaded?.accountName ? <> Leave it empty to use <strong>{loaded.accountName}</strong>, from your account.</> : ' Leave it empty to use the name on your account.'}
            </p>
            <input
              id="cch-agent-name"
              className="cch-input"
              autoFocus
              maxLength={40}
              value={name}
              placeholder={loaded?.accountName ?? 'Your name'}
              disabled={!loaded || busy}
              onChange={(e) => setName(e.target.value)}
            />

            {kinds && kinds.length > 0 ? (
              <fieldset className="cch-notif" disabled={busy}>
                <legend className="cch-field-label">Your notifications</legend>
                <p className="cch-muted">
                  On the site means the bell and the Notifications page. A browser alert pops up on the devices where you have switched desktop alerts on.
                </p>
                {kinds.map((kind) => (
                  <div key={kind.id} className="cch-notif-kind">
                    <div className="cch-notif-name">{kind.label}</div>
                    {browserOnly(kind) ? null : (
                      <label className="cch-notif-check">
                        <input
                          type="checkbox"
                          checked={kind.pref.show}
                          onChange={(e) => setPref(kind.id, { show: e.target.checked, browser: kind.pref.browser })}
                        />
                        On the site
                      </label>
                    )}
                    <label className="cch-notif-check">
                      <input
                        type="checkbox"
                        // A kind hidden from the site is never announced either,
                        // so the browser switch says so rather than lying.
                        checked={kind.pref.show && kind.pref.browser}
                        disabled={!browserOnly(kind) && !kind.pref.show}
                        onChange={(e) => setPref(kind.id, { show: browserOnly(kind) ? true : kind.pref.show, browser: e.target.checked })}
                      />
                      Browser alert
                    </label>
                  </div>
                ))}
              </fieldset>
            ) : null}

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
