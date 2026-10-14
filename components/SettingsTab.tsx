'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/modules/chat/lib/constants'
import type { ChatSettings } from '@/modules/chat/lib/settings'

type Loaded = ChatSettings & { consentGate?: 'category' | 'none'; adminPath?: string | null }

// Settings > Live Chat. Deliberately short: there is not much to set, which is
// rather the point of this module.

export function ChatSettingsTab() {
  const [settings, setSettings] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    fetch(`${API_BASE}/admin/settings`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: Loaded | null) => { if (live && json) setSettings(json) })
      .catch(() => { if (live) setErr('The settings could not be loaded.') })
    return () => { live = false }
  }, [])

  if (!settings) return <div className="card"><p>{err || 'Loading…'}</p></div>

  function set<K extends keyof ChatSettings>(key: K, value: ChatSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
    setMsg('')
  }

  const secs = (v: string) => Math.max(0, Math.min(3600, Math.round(Number(v) || 0)))

  async function saveAll() {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(json?.error ?? 'Those settings could not be saved.')
      setMsg('Saved.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Those settings could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2 className="card-title">Live Chat</h2>
      <p className="field-hint">
        Add the Live Chat block to your header or footer layout and the bubble appears on every page that uses it.
        Chats are answered from Inbox, from the bubble on the site while you are signed in, or from the Unified Inbox if you have it.
      </p>

      <label className="settings-check">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        Show the chat bubble on the site
      </label>

      <div className="field">
        <label htmlFor="chat-label">Bubble label</label>
        <input id="chat-label" maxLength={40} value={settings.bubbleLabel} onChange={(e) => set('bubbleLabel', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="chat-greeting">Greeting</label>
        <textarea id="chat-greeting" rows={3} maxLength={300} value={settings.greeting} onChange={(e) => set('greeting', e.target.value)} />
        <p className="field-hint">The first thing a visitor sees when they open the chat.</p>
      </div>

      <div className="field">
        <label htmlFor="chat-position">Corner</label>
        <select id="chat-position" value={settings.position} onChange={(e) => set('position', e.target.value === 'left' ? 'left' : 'right')}>
          <option value="right">Bottom right</option>
          <option value="left">Bottom left</option>
        </select>
      </div>

      <label className="settings-check">
        <input type="checkbox" checked={settings.hideBubbleOnMobile} onChange={(e) => set('hideBubbleOnMobile', e.target.checked)} />
        Hide the floating bubble on phones
      </label>
      <p className="field-hint">
        For sites with a Mobile Bar: add its <strong>Live chat: message us</strong> cell and the chat opens from there instead.
        The bubble stays on larger screens.
      </p>

      <div className="field">
        <label htmlFor="chat-away-label">Bubble label when offline</label>
        <input id="chat-away-label" maxLength={40} value={settings.awayLabel} onChange={(e) => set('awayLabel', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="chat-away">Message when offline</label>
        <textarea id="chat-away" rows={3} maxLength={300} value={settings.awayMessage} onChange={(e) => set('awayMessage', e.target.value)} />
        <p className="field-hint">Shown instead of the greeting while you are set to offline. The Online/Offline switch lives on the Inbox tab and on the bubble you see when signed in.</p>
      </div>

      <h3 className="card-title" style={{ marginTop: 'var(--space-6)' }}>Visitors and cookies</h3>
      {settings.consentGate === 'none' ? (
        <div className="alert alert-warning" role="status">
          Your cookie banner has no <strong>Live chat</strong> switch on it (or the banner is off), so visitors are never asked about it.
          Until they are, chatting works as it always has, nobody is asked first, and the visitor list stays empty because nobody has agreed to be on it.
          Add the Live chat category on the GDPR tab - this module offers it as a one-click suggestion there.{' '}
          {settings.adminPath ? <a href={`/${settings.adminPath}/config?tab=gdpr#gdpr-banner`}>Open the cookie banner settings</a> : null}
        </div>
      ) : (
        <p className="field-hint">
          Your cookie banner carries the Live chat switch. A visitor who has not said yes to it is asked to before they can send a message,
          and anybody who said no is shown the cookie settings when they try.
        </p>
      )}

      <label className="settings-check">
        <input type="checkbox" checked={settings.trackVisitors} onChange={(e) => set('trackVisitors', e.target.checked)} />
        Show who is on the site, with the pages they have looked at and what is in their basket
      </label>
      <p className="field-hint">
        Only visitors who said yes to the Live chat cookies are listed. You can message them first, from Inbox or the bubble you see when signed in.
        Their trail is deleted a week after they were last here, or straight away if they change their mind.
      </p>

      <label className="settings-check">
        <input type="checkbox" checked={settings.welcomeEnabled} onChange={(e) => set('welcomeEnabled', e.target.checked)} />
        Send a welcome message to visitors who have not written to us
      </label>
      <div className="field">
        <label htmlFor="chat-welcome-message">Welcome message</label>
        <textarea id="chat-welcome-message" rows={2} maxLength={300} value={settings.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="chat-welcome-delay">Send it after (seconds)</label>
        <input id="chat-welcome-delay" type="number" min={0} max={3600} value={settings.welcomeDelaySeconds} onChange={(e) => set('welcomeDelaySeconds', secs(e.target.value))} />
        <p className="field-hint">
          Counted from when the visitor arrived. Sent once to each visitor, while you are online and they have no chat going.
          It appears in their chat as a message from your team. Needs the visitor list above switched on, and only reaches visitors who said yes to the Live chat cookies.
        </p>
      </div>

      <label className="settings-check">
        <input type="checkbox" checked={settings.cartMessageEnabled} onChange={(e) => set('cartMessageEnabled', e.target.checked)} />
        Send a message when someone adds to their basket
      </label>
      <div className="field">
        <label htmlFor="chat-cart-message">Basket message</label>
        <textarea id="chat-cart-message" rows={2} maxLength={300} value={settings.cartMessage} onChange={(e) => set('cartMessage', e.target.value)} />
        <p className="field-hint">
          Sent once to each visitor, the first time they add something, while you are online and they have no chat going.
          It appears in their chat as a message from your team. Needs the visitor list above switched on, and only reaches visitors who said yes to the Live chat cookies.
        </p>
      </div>

      <div className="field">
        <label htmlFor="chat-cart-delay">Send the basket message after (seconds)</label>
        <input id="chat-cart-delay" type="number" min={0} max={3600} value={settings.cartMessageDelaySeconds} onChange={(e) => set('cartMessageDelaySeconds', secs(e.target.value))} />
        <p className="field-hint">Counted from their first add. 0 sends it straight away. If they have started chatting with you by then, it is not sent.</p>
      </div>

      <label className="settings-check">
        <input type="checkbox" checked={settings.transcripts} onChange={(e) => set('transcripts', e.target.checked)} />
        Let visitors email themselves a copy of the chat when they end it
      </label>

      <div className="field">
        <label htmlFor="chat-retention">Keep chats for (months)</label>
        <input
          id="chat-retention"
         
          type="number"
          min={1}
          max={120}
          value={settings.retentionMonths}
          onChange={(e) => set('retentionMonths', Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
        />
        <p className="field-hint">Chats with nothing said in them for longer than this are deleted overnight, attachments and all.</p>
      </div>

      {err ? <div className="alert alert-danger" role="alert">{err}</div> : null}
      {msg ? <div className="alert alert-success" role="status">{msg}</div> : null}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={saveAll}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  )
}
