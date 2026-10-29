'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CONSENT_CHANGE_EVENT } from '@/lib/consent/gate'
import type { ConsentBannerConfig, ConsentDecision } from '@/lib/consent/types'
import { API_BASE, CHAT_OPEN_EVENT, CONSENT_CATEGORY, PRESENCE_HEADER, TYPING_IDLE_MS, VISITOR_HEADER, VISITOR_STORAGE_KEY } from '@/modules/chat/lib/constants'
import { cleanEmail, cleanPhone } from '@/modules/chat/lib/text'
import { withoutLinks } from '@/modules/chat/lib/links'
import { publishUnread } from '@/modules/chat/lib/unread'
import { grantChatConsent, openCookieSettings, readChatConsent, type ChatConsent } from '@/modules/chat/lib/consent-client'
import type { ClientMessage } from '@/modules/chat/lib/serialise'
import { BodyPortal, ChatStyles, Composer, MessageList, TypingNote, mergeMessages, messageRequest, readError } from './ui'
import { playChime, playSent, unlockAudio } from './sound'
import { useCartDrawerDodge } from './cart-dock'
import { forgetPresence, usePresence, type PresenceReply } from './presence'

// The chat as a visitor sees it. Nothing is stored and nothing is fetched until
// they send their first message; from then on their browser holds the claim to
// that one chat in localStorage and asks for anything newer every few seconds
// (quicker while the window is open, slower while it is not).
//
// Where the site's cookie banner carries the Live chat category, none of that
// happens until the visitor says yes to it: the window asks first, and a visitor
// who said no is shown the cookie settings when they try to send something.
// With a yes, and the owner's visitor list switched on, the browser also checks
// in as they move around, which is how we see where they are and what is in
// their basket, and how a chat we start with them finds its way here.

type Saved = {
  claim?: string
  name?: string
  email?: string
  phone?: string
  /** The newest message they have seen, so peeks only show what is new. */
  seen?: number
  /** Whether we have asked about notifications, so we ask once. */
  asked?: boolean
  /** Whether a push subscription is in place, so the tab does not also pop one. */
  pushed?: boolean
  /** The claim on this browser's visitor row, once it has checked in. */
  presence?: string
  /** The visitor muted the new-message sound; it is on until they do. */
  muted?: boolean
  /** The newest message we have already chimed for, so a reload never repeats it. */
  chimed?: number
}

/** Per tab, so the window follows the visitor from page to page and no further. */
const OPEN_STORAGE_KEY = 'cactus-chat-window-open'

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
  /** The site's cookie banner, when it carries the Live chat category; null when
   *  it does not, and nobody can be asked. */
  consent: ConsentBannerConfig | null
  /** The owner's visitor list is switched on. */
  track: boolean
}

export function VisitorWidget({ position, label: onlineLabel, greeting: onlineGreeting, transcripts, hideOnMobile, online: initialOnline, awayLabel, awayMessage, consent, track }: Props) {
  const [online, setOnline] = useState(initialOnline)
  useCartDrawerDodge(position)
  const label = online ? onlineLabel : awayLabel
  const greeting = online ? onlineGreeting : awayMessage
  const [saved, setSaved] = useState<Saved>({})
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ClientMessage[]>([])
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const [peeks, setPeeks] = useState<ClientMessage[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [editing, setEditing] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [askNotify, setAskNotify] = useState(false)
  const [ending, setEnding] = useState(false)
  const [ended, setEnded] = useState<string | null>(null)
  const [chatConsent, setChatConsent] = useState<ChatConsent | null>(null)
  const [askConsent, setAskConsent] = useState(false)
  const [granting, setGranting] = useState(false)
  const reopenOnGrant = useRef(false)
  const lastId = useRef(0)
  const typedAt = useRef(0)
  // Whoever on our side is typing: a name, '' when unnamed, null when nobody.
  const [agentTyping, setAgentTyping] = useState<string | null>(null)
  const savedRef = useRef<Saved>({})
  // Nothing is stored, fetched or checked in until this is true.
  const allowed = consent === null || chatConsent?.granted === true

  const update = useCallback((patch: Partial<Saved> | null) => {
    // Starting over forgets the chat, never the visitor's wish for quiet.
    const next = patch === null ? { muted: savedRef.current.muted } : { ...savedRef.current, ...patch }
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
    setPhone(initial.phone ?? '')
    if (new URLSearchParams(window.location.search).get('chat') === 'open') setOpen(true)
    // A page change remounts the window, so a window left open comes back open.
    try { if (sessionStorage.getItem(OPEN_STORAGE_KEY) === '1') setOpen(true) } catch { /* no session storage: it starts closed */ }
  }, [])

  const openHydrated = useRef(false)
  useEffect(() => {
    if (!openHydrated.current) { openHydrated.current = true; return }
    try { if (open) sessionStorage.setItem(OPEN_STORAGE_KEY, '1'); else sessionStorage.removeItem(OPEN_STORAGE_KEY) } catch { /* nothing to remember it in */ }
  }, [open])

  // Wake the chime's audio the first time the visitor touches the page.
  useEffect(() => {
    const events = ['pointerdown', 'keydown'] as const
    const wake = () => { unlockAudio(); events.forEach((e) => window.removeEventListener(e, wake)) }
    events.forEach((e) => window.addEventListener(e, wake))
    return () => events.forEach((e) => window.removeEventListener(e, wake))
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

  // The visitor's answer, as it stands now and every time it changes - from the
  // banner, the privacy page, another tab's banner on its next load, or here.
  useEffect(() => {
    if (!consent) return
    const apply = (next: ChatConsent) => {
      setChatConsent(next)
      if (next.granted) {
        setAskConsent(false)
        if (reopenOnGrant.current) { reopenOnGrant.current = false; setOpen(true) }
        return
      }
      // A no (or a yes taken back) means this browser keeps nothing for the chat:
      // the trail goes from our side, and the claims from theirs.
      if (next.decided) {
        const presence = savedRef.current.presence
        if (presence) void forgetPresence(presence)
        if (Object.keys(savedRef.current).length > 0) {
          savedRef.current = {}
          try { localStorage.removeItem(VISITOR_STORAGE_KEY) } catch { /* nothing to remove */ }
          setSaved({})
          setMessages([])
          setStatus('open')
          lastId.current = 0
        }
      }
    }
    // Read on mount: the cookie is not available during render.
    apply(readChatConsent(consent))
    const changed = (e: Event) => {
      const decision = (e as CustomEvent<ConsentDecision>).detail ?? {}
      apply({ granted: decision[CONSENT_CATEGORY] === true, decided: true })
    }
    window.addEventListener(CONSENT_CHANGE_EVENT, changed)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, changed)
  }, [consent])

  const claim = allowed ? saved.claim : undefined
  const headers = useCallback((): Record<string, string> => (savedRef.current.claim ? { [VISITOR_HEADER]: savedRef.current.claim } : {}), [])

  const statusRef = useRef<'open' | 'closed'>('open')
  useEffect(() => { statusRef.current = status }, [status])

  // A chat we started is claimed with the secret this browser already holds for
  // its visitor row. Picked up when this browser has no chat on the go, or only
  // one that has ended.
  const onPresence = useCallback((reply: PresenceReply) => {
    if (reply.claim) update({ presence: reply.claim })
    if (typeof reply.online === 'boolean') setOnline(reply.online)
    const presence = savedRef.current.presence
    if (!reply.chat || !presence) return
    const secret = presence.slice(presence.indexOf('.') + 1)
    const current = savedRef.current.claim
    if (current?.startsWith(`${reply.chat}.`)) return
    if (current && statusRef.current === 'open') return
    lastId.current = 0
    setMessages([])
    setEnded(null)
    setStatus('open')
    update({ claim: `${reply.chat}.${secret}`, seen: 0, pushed: false })
    // Details saved before there was a chat would otherwise wait for their
    // first message; a chat we started gives them somewhere to go now.
    const { name: knownName, email: knownEmail, phone: knownPhone } = savedRef.current
    if (knownName || knownEmail || knownPhone) {
      fetch(`${API_BASE}/widget/details`, {
        method: 'POST',
        headers: { [VISITOR_HEADER]: `${reply.chat}.${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: knownName || undefined, email: knownEmail || undefined, phone: knownPhone || undefined }),
      }).catch(() => { /* they ride along with the next message instead */ })
    }
  }, [update])
  usePresence({
    enabled: track && consent !== null && chatConsent?.granted === true,
    presenceClaim: () => savedRef.current.presence,
    chatClaim: () => savedRef.current.claim,
    onReply: onPresence,
    // The site stopped listing visitors, or the server does not see the yes:
    // the claim on a row that is gone is no use to anybody.
    onRefused: () => { if (savedRef.current.presence) update({ presence: undefined }) },
  })

  const poll = useCallback(async (seen: boolean) => {
    if (!savedRef.current.claim) return
    try {
      // Typing since the last ask (only while the window is open and in front):
      // the team sees "typing…" on their next look.
      const typing = seen && Date.now() - typedAt.current < TYPING_IDLE_MS
      const res = await fetch(`${API_BASE}/widget/messages?after=${lastId.current}${seen ? '&seen=1' : ''}${typing ? '&typing=1' : ''}`, { headers: headers(), cache: 'no-store' })
      if (res.status === 404) { update(null); setMessages([]); lastId.current = 0; return }
      if (!res.ok) return
      const json = (await res.json()) as { online?: boolean; status: 'open' | 'closed'; typing?: string | null; messages: ClientMessage[] }
      if (typeof json.online === 'boolean') setOnline(json.online)
      setStatus(json.status)
      setAgentTyping(json.status === 'open' && typeof json.typing === 'string' ? json.typing : null)
      if (json.messages.length === 0) return
      lastId.current = Math.max(lastId.current, json.messages[json.messages.length - 1]?.id ?? 0)
      setMessages((prev) => mergeMessages(prev, json.messages))
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
      if (latest && latest.id > (savedRef.current.chimed ?? 0)) {
        if (!savedRef.current.muted) playChime()
        update({ chimed: latest.id })
      }
      if (latest && document.hidden && !savedRef.current.pushed && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(latest.authorName ? `${latest.authorName} replied` : 'New message', { body: withoutLinks(latest.body).slice(0, 160), tag: 'cactus-chat' }) } catch { /* some browsers only allow these from a worker */ }
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

  // A page can be served from a cache that is hours old, so the online/away
  // answer baked into it is only a first guess: it is checked fresh as the page
  // loads, and again each time the window opens or closes.
  useEffect(() => {
    let live = true
    fetch(`${API_BASE}/widget/status`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { online: boolean } | null) => { if (live && json) setOnline(json.online) })
      .catch(() => { /* the page's own answer stands */ })
    return () => { live = false }
  }, [open])

  async function send(body: string, files: File[]): Promise<boolean> {
    if (!allowed) {
      // Kept in the box (false), so nothing typed is lost while they decide.
      setAskConsent(true)
      if (chatConsent?.decided) showCookieSettings()
      return false
    }
    // Name and email ride along with every message, not just the first, so a
    // visitor who fills them in halfway through is not ignored.
    const res = await fetch(`${API_BASE}/widget/messages`, messageRequest(
      { body, name: name.trim() || undefined, email: cleanEmail(email) ?? undefined, phone: cleanPhone(phone) ?? undefined, page: window.location.pathname },
      files,
      // The visitor row's claim too, so a chat that starts now is tied to the
      // visitor at once instead of at their next check-in.
      savedRef.current.presence ? { ...headers(), [PRESENCE_HEADER]: savedRef.current.presence } : headers(),
    ))
    if (!res.ok) throw new Error(await readError(res))
    const json = (await res.json()) as { claim: string | null; message: ClientMessage; notice?: ClientMessage | null }
    const details = { name: name.trim() || savedRef.current.name, email: cleanEmail(email) ?? savedRef.current.email, phone: cleanPhone(phone) ?? savedRef.current.phone }
    update(json.claim ? { claim: json.claim, ...details, seen: 0 } : details)
    // Merged rather than appended, and the poll's place left where it was: a
    // reply from us that landed just before this message is still fetched.
    // A note that we have gone offline since comes back with it, so it shows at
    // once rather than on the next poll.
    setMessages((prev) => mergeMessages(prev, json.notice ? [json.message, json.notice] : [json.message]))
    typedAt.current = 0
    setStatus('open')
    if (!savedRef.current.muted) playSent()
    if (!savedRef.current.asked && 'Notification' in window && Notification.permission === 'default') setAskNotify(true)
    return true
  }

  // Saving the contact box on its own, so details reach us without the visitor
  // having to send a message first. The same box edits them later: every field
  // is sent, and one left empty is cleared.
  async function saveDetails() {
    const nextName = name.trim()
    const typedEmail = email.trim()
    const nextEmail = typedEmail ? cleanEmail(typedEmail) : null
    if (typedEmail && !nextEmail) { setDetailsError('That email address does not look quite right.'); return }
    const typedPhone = phone.trim()
    const nextPhone = typedPhone ? cleanPhone(typedPhone) : null
    if (typedPhone && !nextPhone) { setDetailsError('That phone number does not look quite right.'); return }
    setSavingDetails(true)
    setDetailsError('')
    try {
      if (savedRef.current.claim) {
        const res = await fetch(`${API_BASE}/widget/details`, {
          method: 'POST',
          headers: { ...headers(), 'content-type': 'application/json' },
          body: JSON.stringify({ name: nextName, email: nextEmail ?? '', phone: nextPhone ?? '' }),
        })
        if (!res.ok) throw new Error(await readError(res))
      }
      // No chat yet: kept here, and sent along with their first message.
      update({ name: nextName || undefined, email: nextEmail ?? undefined, phone: nextPhone ?? undefined })
      // Shown back the way it was stored, so 07332 342 234 reads 07332342234.
      setName(nextName)
      setEmail(nextEmail ?? '')
      setPhone(nextPhone ?? '')
      setEditing(false)
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'Those details could not be saved. Please try again.')
    } finally {
      setSavingDetails(false)
    }
  }

  function editDetails() {
    setDetailsError('')
    setEditing(true)
  }

  function cancelEditing() {
    setName(saved.name ?? '')
    setEmail(saved.email ?? '')
    setPhone(saved.phone ?? '')
    setDetailsError('')
    setEditing(false)
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

  async function allowChat() {
    if (!consent) return
    setGranting(true)
    try { await grantChatConsent(consent) } finally { setGranting(false) }
  }

  // The banner's switches, with the chat tucked away so it is not sat on top of
  // them; it opens again by itself if they switch Live chat on.
  function showCookieSettings() {
    if (!openCookieSettings()) return
    reopenOnGrant.current = true
    setOpen(false)
  }

  function startAgain() {
    update({ asked: savedRef.current.asked, name: savedRef.current.name, email: savedRef.current.email, phone: savedRef.current.phone, presence: savedRef.current.presence, claim: undefined, seen: 0, pushed: false })
    setMessages([])
    setEnded(null)
    setStatus('open')
    lastId.current = 0
  }

  return (
    <BodyPortal>
    <div className="cch-root">
      <ChatStyles />
      <div className={`cch-dock ${position}${hideOnMobile ? ' cch-no-launcher-mobile' : ''}`}>
        {open ? (
          <section className="cch-panel" aria-label="Live chat">
            <header className="cch-head">
              <h2>{label}</h2>
              {claim && status === 'open' && !ending ? <button type="button" onClick={() => setEnding(true)}>End chat</button> : null}
              <button
                type="button"
                aria-label={saved.muted ? 'Unmute new message sound' : 'Mute new message sound'}
                aria-pressed={saved.muted === true}
                title={saved.muted ? 'Sound off - click to turn on' : 'Sound on - click to mute'}
                onClick={() => { unlockAudio(); if (saved.muted) playChime(); update({ muted: !saved.muted }) }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" />
                  {saved.muted ? <path d="M23 9l-6 6M17 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
                </svg>
              </button>
              <button type="button" aria-label="Minimise chat" onClick={() => setOpen(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </header>
            {allowed && status === 'open' ? (
              <ContactBox
                online={online}
                saved={saved}
                // Open while we have nothing, and while we are away with no way
                // to reach them: a name alone is not somewhere to send a reply.
                editing={editing || !(saved.name || saved.email || saved.phone) || (!online && !saved.email && !saved.phone)}
                canCancel={editing}
                name={name}
                email={email}
                phone={phone}
                busy={savingDetails}
                error={detailsError}
                onName={(v) => { setName(v); setDetailsError('') }}
                onEmail={(v) => { setEmail(v); setDetailsError('') }}
                onPhone={(v) => { setPhone(v); setDetailsError('') }}
                onEdit={editDetails}
                onSave={saveDetails}
                onCancel={cancelEditing}
              />
            ) : null}
            <MessageList messages={messages} mine="visitor" intro={messages.some((m) => m.sender === 'agent') ? null : greeting}>
              {claim && status === 'open' && agentTyping !== null ? <TypingNote who={agentTyping} /> : null}
              {!allowed && chatConsent ? (
                <ConsentCard
                  declined={chatConsent.decided}
                  emphasised={askConsent}
                  track={track}
                  busy={granting}
                  onAllow={allowChat}
                  onSettings={showCookieSettings}
                />
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
            {status === 'closed' && claim ? null : <Composer onSend={send} autoFocus draftKey="visitor" onTyping={() => { typedAt.current = Date.now() }} />}
          </section>
        ) : (
          <>
            {peeks.length > 0 ? (
              <div className="cch-peeks">
                {peeks.map((p) => (
                  <div key={p.id} style={{ position: 'relative' }}>
                    <button type="button" className="cch-peek" onClick={() => setOpen(true)}>
                      <strong>{p.authorName ?? 'New message'}</strong>
                      <span>{withoutLinks(p.body) || (p.attachments[0] ? `📎 ${p.attachments[0].filename}` : '')}</span>
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
    </BodyPortal>
  )
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}

// Pinned under the header, above the greeting and every message. Empty it is a
// small form (name with the phone number to its right, then email); once
// something is saved it shrinks to what we hold, each with a pencil to change it.
function ContactBox({ online, saved, editing, canCancel, name, email, phone, busy, error, onName, onEmail, onPhone, onEdit, onSave, onCancel }: {
  online: boolean
  saved: Saved
  editing: boolean
  canCancel: boolean
  name: string
  email: string
  phone: string
  busy: boolean
  error: string
  onName: (v: string) => void
  onEmail: (v: string) => void
  onPhone: (v: string) => void
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
}) {
  if (!editing) {
    const items: Array<{ key: string; label: string; value: string }> = []
    if (saved.name) items.push({ key: 'name', label: 'name', value: saved.name })
    if (saved.phone) items.push({ key: 'phone', label: 'phone number', value: saved.phone })
    if (saved.email) items.push({ key: 'email', label: 'email', value: saved.email })
    return (
      <div className="cch-contact" aria-label="Your contact details">
        {items.map((item) => (
          <span key={item.key} className="cch-contact-item">
            <span className="cch-contact-value" title={item.value}>{item.value}</span>
            <button type="button" className="cch-contact-edit" aria-label={`Change your ${item.label}`} title={`Change your ${item.label}`} onClick={onEdit}><PencilIcon /></button>
          </span>
        ))}
        {!saved.name || !saved.phone || !saved.email ? <button type="button" className="cch-contact-add" onClick={onEdit}>Add more details</button> : null}
      </div>
    )
  }
  return (
    <form className="cch-contact form" onSubmit={(e) => { e.preventDefault(); onSave() }}>
      <p className="cch-muted">{online ? 'Tell us who you are, if you like - it helps us reply if you have to dash off.' : 'Leave your email or phone number if you would like a reply - we cannot answer straight away.'}</p>
      <div className="cch-contact-grid">
        <input className="cch-input" placeholder="Your name (optional)" aria-label="Your name" autoComplete="name" value={name} maxLength={80} onChange={(e) => onName(e.target.value)} />
        <input className="cch-input" type="tel" inputMode="tel" placeholder="Phone (optional)" aria-label="Your phone number" autoComplete="tel" value={phone} maxLength={40} onChange={(e) => onPhone(e.target.value)} />
      </div>
      <input className="cch-input" type="email" placeholder="Your email (optional)" aria-label="Your email" autoComplete="email" value={email} maxLength={254} onChange={(e) => onEmail(e.target.value)} />
      {error ? <div className="cch-error" role="alert">{error}</div> : null}
      {name.trim() || email.trim() || phone.trim() || canCancel ? (
        <div className="cch-row">
          <button type="submit" className="cch-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          {canCancel ? <button type="button" className="cch-btn" disabled={busy} onClick={onCancel}>Cancel</button> : null}
        </div>
      ) : null}
    </form>
  )
}

function EndChat({ transcripts, email, onEnd, onCancel }: {
  transcripts: boolean
  email: string
  onEnd: (withTranscript: boolean, to: string) => Promise<void>
  onCancel: () => void
}) {
  // Unticked until they ask: nobody should get an email they did not choose.
  const [want, setWant] = useState(false)
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

function ConsentCard({ declined, emphasised, track, busy, onAllow, onSettings }: {
  declined: boolean
  emphasised: boolean
  track: boolean
  busy: boolean
  onAllow: () => void
  onSettings: () => void
}) {
  const what = track
    ? 'Live chat keeps a small note in your browser so it can find this conversation again, and lets us see which page you are on and what is in your basket, so we can actually help.'
    : 'Live chat keeps a small note in your browser so it can find this conversation again.'
  return (
    <div className="cch-card" role={emphasised ? 'alert' : undefined} style={emphasised ? { borderColor: 'var(--color-primary)' } : undefined}>
      <p><strong>{declined ? 'Live chat is switched off in your cookie settings' : 'Before we chat'}</strong></p>
      <p>
        {what}{' '}
        {declined
          ? 'You said no to that, which is entirely fair, but it does mean we cannot chat until you switch it on.'
          : 'We need your OK for that first.'}
      </p>
      <div className="cch-row">
        <button type="button" className="cch-btn primary" disabled={busy} onClick={onAllow}>{busy ? 'One moment…' : 'Allow live chat'}</button>
        <button type="button" className="cch-btn" onClick={onSettings}>Cookie settings</button>
      </div>
    </div>
  )
}
