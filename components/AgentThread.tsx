'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE, TYPING_IDLE_MS } from '@/modules/chat/lib/constants'
import type { ClientConversation, ClientMessage, ClientVisitor } from '@/modules/chat/lib/serialise'
import { Composer, MessageList, TypingNote, mergeMessages, messageRequest, readError, timeLabel } from './ui'
import { spanLabel, VisitorDetails } from './Visitors'
import { NameOverrideButton } from './NameOverride'
import { MuteButton, playChime, playSent, useAdminMuted } from './sound'
import { availabilityFromServer, nudgeAdmin, usePolling } from './live'

// One chat from our side, used by both the inbox tab and the bubble on the
// site. It asks for anything new every few seconds while it is on screen (and
// at once when the tab comes back, or a colleague in this browser does
// something), marks the chat read as it does, and tells the list beside it what
// it learnt so the two never disagree for a poll's worth of seconds.

type ChatList = {
  conversations: ClientConversation[]
  unread: number
  loaded: boolean
  refresh: () => void
  /** Folds in what an open chat just learnt about itself. */
  patch: (c: ClientConversation) => void
  remove: (id: string) => void
}

/**
 * The open or ended chats, kept current. `quietId` is the chat on screen,
 * which chimes for itself (its own poll marks it read, so the list may never
 * see it unread). Only the open list chimes.
 */
export function useChatList(status: 'open' | 'closed', everyMs: number, opts: { enabled?: boolean; quietId?: string | null } = {}): ChatList {
  const { enabled = true, quietId = null } = opts
  const [conversations, setConversations] = useState<ClientConversation[]>([])
  const [unread, setUnread] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [muted] = useAdminMuted()
  const mutedRef = useRef(muted)
  useEffect(() => { mutedRef.current = muted }, [muted])
  const quietRef = useRef(quietId)
  useEffect(() => { quietRef.current = quietId }, [quietId])
  // Each waiting chat's newest message as of the last look, to tell news from
  // the same news again.
  const waiting = useRef<Map<string, string> | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/admin/conversations?status=${status}`, { cache: 'no-store' })
    if (!res.ok) return
    const json = (await res.json()) as { conversations: ClientConversation[]; unread: number; online?: boolean }
    setConversations(json.conversations)
    setUnread(json.unread)
    setLoaded(true)
    if (typeof json.online === 'boolean') availabilityFromServer(json.online)
    if (status !== 'open') return
    const now = new Map(json.conversations.filter((c) => c.unread > 0).map((c) => [c.id, c.lastMessageAt]))
    const before = waiting.current
    waiting.current = now
    // Something new since the last look (not the first load): sound it.
    if (before && !mutedRef.current && [...now].some(([id, at]) => id !== quietRef.current && before.get(id) !== at)) playChime()
  }, [status])

  const refresh = usePolling(load, { everyMs, hiddenMs: Math.max(everyMs, 30_000), enabled, key: status })

  const listRef = useRef(conversations)
  useEffect(() => { listRef.current = conversations }, [conversations])

  const patch = useCallback((c: ClientConversation) => {
    const prev = listRef.current
    const i = prev.findIndex((p) => p.id === c.id)
    const old = prev[i]
    if (!old) return
    if (c.status !== status) {
      listRef.current = prev.filter((p) => p.id !== c.id)
    } else {
      // The list's own extras (waiting, on the site) stay until it looks again.
      const next = { ...c, waitingSince: c.waitingSince ?? old.waitingSince, visitorOnline: c.visitorOnline ?? old.visitorOnline }
      const copy = [...prev]
      copy[i] = next
      listRef.current = copy
    }
    if (old.unread > 0 && c.unread === 0) {
      if (status === 'open') setUnread((n) => Math.max(0, n - 1))
      waiting.current?.delete(c.id)
    }
    setConversations(listRef.current)
  }, [status])

  const remove = useCallback((id: string) => {
    setConversations((prev) => prev.filter((p) => p.id !== id))
  }, [])

  return { conversations, unread, loaded, refresh, patch, remove }
}

export function visitorName(c: Pick<ClientConversation, 'visitorName' | 'visitorEmail'>): string {
  return c.visitorName || c.visitorEmail || 'Visitor'
}

export function ConversationList({ conversations, activeId, onPick, empty }: {
  conversations: ClientConversation[]
  activeId?: string | null
  onPick: (id: string) => void
  empty: string
}) {
  if (conversations.length === 0) return <div className="cch-list"><p className="cch-muted" style={{ padding: 14 }}>{empty}</p></div>
  return (
    <div className="cch-list">
      {conversations.map((c) => {
        const typing = c.status === 'open' && c.visitorTyping
        return (
          <button
            key={c.id}
            type="button"
            className={`cch-item${c.unread > 0 ? ' unread' : ''}${c.id === activeId ? ' active' : ''}`}
            aria-current={c.id === activeId ? 'true' : undefined}
            onClick={() => onPick(c.id)}
          >
            <div className="cch-item-top">
              <span className="cch-item-name">
                {c.visitorOnline !== null ? <span className={`cch-presence${c.visitorOnline ? ' on' : ''}`} title={c.visitorOnline ? 'On the site now' : 'Has left the site'} aria-hidden="true" /> : null}
                {visitorName(c)}
              </span>
              <span className="cch-item-tags">
                {c.unread > 0 ? <span className="cch-count" aria-label="Unread">{c.unread}</span> : null}
                <time dateTime={c.lastMessageAt}>{timeLabel(c.lastMessageAt)}</time>
              </span>
            </div>
            <div className="cch-item-preview">{typing ? <em>Typing…</em> : (c.preview ?? '')}</div>
            {c.status === 'open' && c.waitingSince ? <span className="cch-wait">Waiting {spanLabel(c.waitingSince)}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** Straight into the reply box on a desk; not on a phone, where that throws the
 *  keyboard over the chat before it has been read. Browser-only: the box is
 *  never drawn on the server. */
function wideScreen(): boolean {
  try { return window.matchMedia('(min-width: 721px)').matches } catch { return false }
}

export function AgentThread({ id, canReply, canManage, onBack, onConversation, onDeleted, compact, othersWaiting = 0 }: {
  id: string
  canReply: boolean
  canManage?: boolean
  onBack?: () => void
  /** Hands the list what this chat learnt about itself on every poll. */
  onConversation?: (c: ClientConversation) => void
  onDeleted?: (id: string) => void
  compact?: boolean
  /** Other chats waiting on us, shown on the back arrow. */
  othersWaiting?: number
}) {
  const [conversation, setConversation] = useState<ClientConversation | null>(null)
  const [visitor, setVisitor] = useState<ClientVisitor | null>(null)
  const [messages, setMessages] = useState<ClientMessage[]>([])
  const [error, setError] = useState('')
  const [gone, setGone] = useState(false)
  const [lostTouch, setLostTouch] = useState(false)
  const failures = useRef(0)
  const goneRef = useRef(false)
  const lastId = useRef(0)
  const loaded = useRef(false)
  const typedAt = useRef(0)
  const [muted, toggleMute] = useAdminMuted()
  const mutedRef = useRef(muted)
  useEffect(() => { mutedRef.current = muted }, [muted])
  const tell = useRef(onConversation)
  useEffect(() => { tell.current = onConversation }, [onConversation])

  const failed = useCallback(() => {
    failures.current += 1
    if (failures.current >= 2) setLostTouch(true)
  }, [])

  const load = useCallback(async () => {
    if (goneRef.current) return
    const typing = Date.now() - typedAt.current < TYPING_IDLE_MS
    let res: Response
    try {
      res = await fetch(`${API_BASE}/admin/conversations/${id}?after=${lastId.current}${document.hidden ? '' : '&read=1'}${typing ? '&typing=1' : ''}`, { cache: 'no-store' })
    } catch {
      failed()
      return
    }
    if (res.status === 404) {
      goneRef.current = true
      setGone(true)
      return
    }
    if (res.status === 401 || res.status === 403) {
      setError('You have been signed out. Sign in again to carry on with this chat.')
      return
    }
    if (!res.ok) { failed(); return }
    failures.current = 0
    setError((e) => (e.startsWith('You have been signed out') ? '' : e))
    setLostTouch(false)
    const json = (await res.json()) as { conversation: ClientConversation; messages: ClientMessage[]; visitor?: ClientVisitor | null }
    setConversation(json.conversation)
    setVisitor(json.visitor ?? null)
    tell.current?.(json.conversation)
    if (json.messages.length > 0) {
      // The first look brings the history back; only later arrivals chime.
      if (loaded.current && !mutedRef.current && json.messages.some((m) => m.sender === 'visitor' && m.id > lastId.current)) playChime()
      lastId.current = Math.max(lastId.current, json.messages[json.messages.length - 1]?.id ?? 0)
      setMessages((prev) => mergeMessages(prev, json.messages))
    }
    loaded.current = true
  }, [id, failed])

  const refresh = usePolling(load, { everyMs: 3_000, hiddenMs: 20_000, key: id })

  async function send(body: string, files: File[]): Promise<boolean> {
    const res = await fetch(`${API_BASE}/admin/conversations/${id}/messages`, messageRequest({ body }, files))
    if (!res.ok) {
      // Ended or deleted under us: show that rather than leave a box that fails.
      if (res.status === 404 || res.status === 409) refresh()
      throw new Error(await readError(res))
    }
    const json = (await res.json()) as { message: ClientMessage }
    typedAt.current = 0
    // Merged, not appended, and the poll's place left alone: a visitor message
    // that landed just before this one is still fetched on the next look.
    setMessages((prev) => mergeMessages(prev, [json.message]))
    if (!mutedRef.current) playSent()
    nudgeAdmin()
    return true
  }

  async function endChat() {
    if (!window.confirm('End this chat? Neither of you can add to it afterwards.')) return
    setError('')
    const res = await fetch(`${API_BASE}/admin/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    })
    if (!res.ok) { setError(await readError(res)); return }
    refresh()
    nudgeAdmin()
  }

  async function remove() {
    if (!window.confirm('Delete this chat and its files for good? There is no undo.')) return
    const res = await fetch(`${API_BASE}/admin/conversations/${id}`, { method: 'DELETE' })
    if (!res.ok) { setError(await readError(res)); return }
    goneRef.current = true
    onDeleted?.(id)
    nudgeAdmin()
    onBack?.()
  }

  const who = conversation ? visitorName(conversation) : 'Visitor'
  const open = conversation?.status === 'open'
  const lastReal = [...messages].reverse().find((m) => m.sender !== 'system')
  const receipt = conversation && lastReal?.sender === 'agent'
    ? { id: lastReal.id, text: conversation.visitorUnread === 0 ? 'Seen' : 'Sent' }
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="cch-head" style={compact ? undefined : { background: 'var(--color-surface)', color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>
        {onBack ? (
          <button type="button" aria-label={othersWaiting > 0 ? `Back to chats (${othersWaiting} other waiting)` : 'Back to chats'} onClick={onBack}>
            ←{othersWaiting > 0 ? <span className="cch-badge cch-back-count">{othersWaiting}</span> : null}
          </button>
        ) : null}
        <h2 title={who}>
          {visitor ? <span className={`cch-presence${visitor.online ? ' on' : ''}`} title={visitor.online ? 'On the site now' : 'Has left the site'} aria-hidden="true" /> : null}
          {who}
        </h2>
        {conversation && canReply && open && !gone ? <button type="button" onClick={endChat}>End chat</button> : null}
        <MuteButton muted={muted} onToggle={toggleMute} />
        {canReply ? <NameOverrideButton /> : null}
        {canManage && !compact && !gone ? <button type="button" onClick={remove}>Delete</button> : null}
      </div>
      {conversation && !compact ? (
        <div className="cch-muted" style={{ padding: '6px 14px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          {conversation.visitorEmail ? <><a href={`mailto:${conversation.visitorEmail}`}>{conversation.visitorEmail}</a> · </> : null}
          {conversation.pageUrl ? <>started on <a href={conversation.pageUrl} target="_blank" rel="noopener noreferrer">{conversation.pageUrl}</a> · </> : null}
          {conversation.notifications ? 'notifications on' : 'notifications off'}
        </div>
      ) : null}
      {visitor && !gone ? (
        <details className="cch-about">
          <summary>
            {visitor.online ? 'On ' : 'Was on '}{visitor.currentTitle || visitor.currentPath || 'the site'}
            {visitor.online ? '' : ` · left ${spanLabel(visitor.lastSeenAt)} ago`}
            {visitor.cart ? ` · basket of ${visitor.cart.reduce((n, l) => n + l.quantity, 0)}` : ''}
          </summary>
          <VisitorDetails visitor={visitor} />
        </details>
      ) : null}
      {lostTouch && !gone ? <div className="cch-banner" role="status">Lost touch with the site. Trying again…</div> : null}
      {error ? <div className="cch-error" role="alert" style={{ padding: '6px 14px' }}>{error}</div> : null}
      {gone ? (
        <div className="cch-body"><p className="cch-muted" style={{ margin: 'auto' }}>This chat has been deleted.</p></div>
      ) : (
        <MessageList messages={messages} mine="agent" theirName={conversation?.visitorName || conversation?.visitorEmail || undefined} receipt={receipt}>
          {open && conversation?.visitorTyping ? <TypingNote who={conversation.visitorName || 'The visitor'} /> : null}
        </MessageList>
      )}
      {canReply && conversation && !gone ? (
        conversation.status === 'closed'
          ? <div className="cch-muted" style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>This chat has ended, so no more messages can be sent.</div>
          : <Composer onSend={send} placeholder="Reply…" draftKey={`agent:${id}`} autoFocus={!compact && wideScreen()} onTyping={() => { typedAt.current = Date.now() }} />
      ) : null}
    </div>
  )
}
