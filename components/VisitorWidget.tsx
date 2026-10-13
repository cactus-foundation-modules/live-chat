'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE, CHAT_OPEN_EVENT, VISITOR_HEADER, VISITOR_STORAGE_KEY } from '@/modules/chat/lib/constants'
import { cleanEmail } from '@/modules/chat/lib/text'
import { publishUnread } from '@/modules/chat/lib/unread'
import type { ClientMessage } from '@/modules/chat/lib/serialise'
import { ChatStyles, Composer, MessageList, messageRequest, readError } from './ui'

// The chat as a visitor sees it. Nothing is stored and nothing is fetched until
// they send their first message; from then on their browser holds the claim to
// that one chat in localStorage and asks for anything newer every few seconds
// (quicker while the window is open, slower while it is not).

type Saved = {
  claim?: string
  name?: string
  email?: string
  /** The newest message they have seen, so peeks only show what is new. */
  seen?: number
  /** Whether we have asked about notifications, so we ask once. */
  asked?: boolean
  /** Whether a push subscription is in place, so the tab does not also pop one. */
  pushed?: boolean
}

function load(): Saved {
  try { return JSON.parse(localStorage.getItem(VISITOR_STORAGE_KEY) ?? '{}') as Saved } catch { return {} }
}
function save(next: Saved) {
  try { localStorage.setItem(VISITOR_STORAGE_KEY, JSON.stringify(next)) } catch { /* private mode: the chat lasts the page */ }
}

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

type Props = {
  position: 'left' | 'right'
  label: string
  greeting: string
  transcripts: boolean
  hideOnMobile: boolean
  /** As of the page render; re-read from the server whenever the window opens. */
  online: boolean
  awayLabel: string
  awayMessage: string
}

export function VisitorWidget({ position, label: onlineLabel, greeting: onlineGreeting, transcripts, hideOnMobile, online: initialOnline, awayLabel, awayMessage }: Props) {
  const [online, setOnline] = useState(initialOnline)
  const label = online ? onlineLabel : awayLabel
  const greeting = online ? onlineGreeting : awayMessage
  const [saved, setSaved] = useState<Saved>({})
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ClientMessage[]>([])
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const [peeks, setPeeks] = useState<ClientMessage[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [askNotify, setAskNotify] = useState(false)
  const [ending, setEnding] = useState(false)
  const [ended, setEnded] = useState<string | null>(null)
  const lastId = useRef(0)
  const savedRef = useRef<Saved>({})

  const update = useCallback((patch: Partial<Saved> | null) => {
    const next = patch === null ? {} : { ...savedRef.current, ...patch }
    savedRef.current = next
    save(next)
    setSaved(next)
  }, [])

  useEffect(() => {
    const initial = load()
    savedRef.current = initial
    // Read once on mount; localStorage is not available during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from browser-only storage
    setSaved(initial)
    setName(initial.name ?? '')
    setEmail(initial.email ?? '')
    if (new URLSearchParams(window.location.search).get('chat') === 'open') setOpen(true)
  }, [])

  // Anything on the page can open the chat, and so can a notification click.
  useEffect(() => {
    const show = () => setOpen(true)
    const fromWorker = (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'cactus-chat-open') show() }
    window.addEventListener(CHAT_OPEN_EVENT, show)
    navigator.serviceWorker?.addEventListener('message', fromWorker)
    return () => {
      window.removeEventListener(CHAT_OPEN_EVENT, show)
      navigator.serviceWorker?.removeEventListener('message', fromWorker)
    }
  }, [])

  const claim = saved.claim
  const headers = useCallback((): Record<string, string> => (savedRef.current.claim ? { [VISITOR_HEADER]: savedRef.current.claim } : {}), [])

  const poll = useCallback(async (seen: boolean) => {
    if (!savedRef.current.claim) return
    try {
      const res = await fetch(`${API_BASE}/widget/messages?after=${lastId.current}${seen ? '&seen=1' : ''}`, { headers: headers(), cache: 'no-store' })
      if (res.status === 404) { update(null); setMessages([]); lastId.current = 0; return }
      if (!res.ok) return
      const json = (await res.json()) as { online?: boolean; status: 'open' | 'closed'; messages: ClientMessage[] }
      if (typeof json.online === 'boolean') setOnline(json.online)
      setStatus(json.status)
      if (json.messages.length === 0) return
      lastId.current = json.messages[json.messages.length - 1]?.id ?? lastId.current
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        return [...prev, ...json.messages.filter((m) => !known.has(m.id))]
      })
      const fresh = json.messages.filter((m) => m.sender === 'agent' && m.id > (savedRef.current.seen ?? 0))
      if (fresh.length === 0) return
      if (seen) {
        update({ seen: lastId.current })
      } else {
        // The window is shut: show what they said as little bubbles above the
        // launcher, the way a text pops up on a phone.
        setPeeks((prev) => [...prev, ...fresh].slice(-3))
      }
      const latest = fresh[fresh.length - 1]
      if (latest && document.hidden && !savedRef.current.pushed && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(latest.authorName ? `${latest.authorName} replied` : 'New message', { body: latest.body.slice(0, 160), tag: 'cactus-chat' }) } catch { /* some browsers only allow these from a worker */ }
      }
    } catch { /* the next round will catch up */ }
  }, [headers, update])

  // The first load brings the whole chat back; after that, only what is new.
  useEffect(() => {
    if (!claim) return
    // Through the microtask queue so the effect body itself sets no state.
    void Promise.resolve().then(() => poll(false))
  }, [claim, poll])

  useEffect(() => {
    if (!claim) return
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const visible = !document.hidden
      await poll(open && visible)
      timer = setTimeout(tick, open && visible ? 3_000 : visible ? 12_000 : 45_000)
    }
    timer = setTimeout(tick, open ? 1_000 : 12_000)
    const wake = () => { if (!document.hidden) { clearTimeout(timer); void tick() } }
    document.addEventListener('visibilitychange', wake)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', wake) }
  }, [claim, open, poll])

  // Opening the window reads everything in it.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing peeks the moment the window opens
    setPeeks([])
    if (lastId.current > (savedRef.current.seen ?? 0)) update({ seen: lastId.current })
  }, [open, update])

  const unread = claim ? messages.filter((m) => m.sender === 'agent' && m.id > (saved.seen ?? 0)).length : 0
  useEffect(() => { publishUnread(unread) }, [unread])

  // A page can be served from a cache; whether anyone is in is checked fresh
  // each time the window opens, for visitors who have not started a chat yet.
  useEffect(() => {
    if (!open) return
    let live = true
    fetch(`${API_BASE}/widget/status`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { online: boolean } | null) => { if (live && json) setOnline(json.online) })
      .catch(() => { /* the page's own answer stands */ })
    return () => { live = false }
  }, [open])

  async function send(body: string, files: File[]): Promise<boolean> {
    const first = !savedRef.current.claim
    const res = await fetch(`${API_BASE}/widget/messages`, messageRequest(
      { body, name: first ? name : undefined, email: first ? cleanEmail(email) : undefined, page: window.location.pathname },
      files,
      headers(),
    ))
    if (!res.ok) throw new Error(await readError(res))
    const json = (await res.json()) as { claim: string | null; message: ClientMessage }
    if (json.claim) update({ claim: json.claim, name: name || undefined, email: cleanEmail(email) ?? undefined, seen: 0 })
    setMessages((prev) => [...prev, json.message])
    lastId.current = Math.max(lastId.current, json.message.id)
    setStatus('open')
    if (!savedRef.current.asked && 'Notification' in window && Notification.permission === 'default') setAskNotify(true)
    return true
  }

  async function enableNotifications() {
    setAskNotify(false)
    update({ asked: true })
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted' || !('serviceWorker' in navigator) || !('PushManager' in window)) return
      const keyRes = await fetch(`${API_BASE}/widget/push`, { headers: headers(), cache: 'no-store' })
      if (!keyRes.ok) return
      const { publicKey } = (await keyRes.json()) as { publicKey: string }
      const registration = await navigator.serviceWorker.register(`${API_BASE}/widget/sw`, { scope: `${API_BASE}/widget/` })
      await navigator.serviceWorker.ready.catch(() => undefined)
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) })
      const res = await fetch(`${API_BASE}/widget/push`, {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })
      if (res.ok) update({ pushed: true })
    } catch {
      // Push is a nicety. The tab still pops a notification while it is open.
    }
  }

  async function endChat(withTranscript: boolean, to: string) {
    const res = await fetch(`${API_BASE}/widget/end`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: withTranscript, email: to }),
    })
    if (!res.ok) throw new Error(await readError(res))
    const json = (await res.json()) as { emailed: string | null }
    setEnding(false)
    setEnded(json.emailed ? `Chat ended. We have emailed a copy to ${json.emailed}.` : 'Chat ended. Thanks for getting in touch.')
    setStatus('closed')
  }

  function startAgain() {
    update({ asked: savedRef.current.asked, name: savedRef.current.name, email: savedRef.current.email, claim: undefined, seen: 0, pushed: false })
    setMessages([])
    setEnded(null)
    setStatus('open')
    lastId.current = 0
  }

  return (
    <div className="cch-root">
      <ChatStyles />
      <div className={`cch-dock ${position}${hideOnMobile ? ' hide-mobile' : ''}`}>
        {open ? (
          <section className="cch-panel" aria-label="Live chat">
            <header className="cch-head">
              <h2>{label}</h2>
              {claim && status === 'open' && !ending ? <button type="button" onClick={() => setEnding(true)}>End chat</button> : null}
              <button type="button" aria-label="Minimise chat" onClick={() => setOpen(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </header>
            <MessageList messages={messages} mine="visitor" intro={greeting}>
              {!claim ? (
                <div className="cch-card">
                  <p className="cch-muted">{online ? 'Tell us who you are, if you like - it helps us reply by email if you have to dash off.' : 'Leave your email if you would like a reply - we cannot answer straight away.'}</p>
                  <input className="cch-input" placeholder="Your name (optional)" aria-label="Your name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                  <input className="cch-input" type="email" placeholder="Your email (optional)" aria-label="Your email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
                </div>
              ) : null}
              {askNotify ? (
                <div className="cch-card">
                  <p>Would you like a browser notification when we reply? Handy if you wander off to another tab.</p>
                  <div className="cch-row">
                    <button type="button" className="cch-btn primary" onClick={enableNotifications}>Yes please</button>
                    <button type="button" className="cch-btn" onClick={() => { setAskNotify(false); update({ asked: true }) }}>No thanks</button>
                  </div>
                </div>
              ) : null}
              {ending ? <EndChat transcripts={transcripts} email={saved.email ?? ''} onEnd={endChat} onCancel={() => setEnding(false)} /> : null}
              {status === 'closed' && claim ? (
                <div className="cch-card">
                  <p>{ended ?? 'This chat has ended.'}</p>
                  <div className="cch-row">
                    <button type="button" className="cch-btn primary" onClick={startAgain}>Start a new chat</button>
                  </div>
                </div>
              ) : null}
            </MessageList>
            {status === 'closed' && claim ? null : <Composer onSend={send} autoFocus />}
          </section>
        ) : (
          <>
            {peeks.length > 0 ? (
              <div className="cch-peeks">
                {peeks.map((p) => (
                  <div key={p.id} style={{ position: 'relative' }}>
                    <button type="button" className="cch-peek" onClick={() => setOpen(true)}>
                      <strong>{p.authorName ?? 'New message'}</strong>
                      <span>{p.body || (p.attachments[0] ? `📎 ${p.attachments[0].filename}` : '')}</span>
                    </button>
                    <button type="button" className="cch-peek-x" aria-label="Dismiss" onClick={() => setPeeks(peeks.filter((x) => x.id !== p.id))}>×</button>
                  </div>
                ))}
              </div>
            ) : null}
            <button type="button" className="cch-launcher" onClick={() => setOpen(true)} aria-label={unread > 0 ? `${label} (${unread} unread)` : label}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              <span>{label}</span>
              {unread > 0 ? <span className="cch-badge">{unread}</span> : null}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function EndChat({ transcripts, email, onEnd, onCancel }: {
  transcripts: boolean
  email: string
  onEnd: (withTranscript: boolean, to: string) => Promise<void>
  onCancel: () => void
}) {
  const [want, setWant] = useState(transcripts)
  const [to, setTo] = useState(email)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function go() {
    if (want && !cleanEmail(to)) { setError('That email address does not look quite right.'); return }
    setBusy(true)
    setError('')
    try { await onEnd(want, to) } catch (err) { setError(err instanceof Error ? err.message : 'That did not work. Please try again.') }
    setBusy(false)
  }

  return (
    <div className="cch-card">
      <p><strong>End this chat?</strong></p>
      {transcripts ? (
        <>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={want} onChange={(e) => setWant(e.target.checked)} />
            Email me a copy of this chat
          </label>
          {want ? <input className="cch-input" type="email" placeholder="you@example.com" aria-label="Email for the transcript" value={to} onChange={(e) => setTo(e.target.value)} /> : null}
        </>
      ) : null}
      {error ? <div className="cch-error" role="alert">{error}</div> : null}
      <div className="cch-row">
        <button type="button" className="cch-btn primary" disabled={busy} onClick={go}>{busy ? 'Ending…' : 'End chat'}</button>
        <button type="button" className="cch-btn" disabled={busy} onClick={onCancel}>Keep chatting</button>
      </div>
    </div>
  )
}
