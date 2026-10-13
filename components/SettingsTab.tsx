'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/modules/chat/lib/constants'
import type { ChatSettings } from '@/modules/chat/lib/settings'

// Settings > Live Chat. Deliberately short: there is not much to set, which is
// rather the point of this module.

export function ChatSettingsTab() {
  const [settings, setSettings] = useState<ChatSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    fetch(`${API_BASE}/admin/settings`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ChatSettings | null) => { if (live && json) setSettings(json) })
      .catch(() => { if (live) setErr('The settings could not be loaded.') })
    return () => { live = false }
  }, [])

  if (!settings) return <div className="card"><p>{err || 'Loading…'}</p></div>

  function set<K extends keyof ChatSettings>(key: K, value: ChatSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
    setMsg('')
  }

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
