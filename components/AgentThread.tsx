'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '@/modules/chat/lib/constants'
import type { ClientConversation, ClientMessage } from '@/modules/chat/lib/serialise'
import { Composer, MessageList, messageRequest, readError } from './ui'

// One chat from our side, used by both the inbox tab and the bubble on the
// site. It asks for anything new every few seconds while it is on screen, and
// marks the chat read as it does.

export function useChatList(status: 'open' | 'closed', everyMs: number) {
  const [conversations, setConversations] = useState<ClientConversation[]>([])
  const [unread, setUnread] = useState(0)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/conversations?status=${status}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { conversations: ClientConversation[]; unread: number }
      setConversations(json.conversations)
      setUnread(json.unread)
      setLoaded(true)
    } catch { /* next round */ }
  }, [status])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await refresh()
      timer = setTimeout(tick, document.hidden ? Math.max(everyMs, 30_000) : everyMs)
    }
    void tick()
    return () => clearTimeout(timer)
  }, [refresh, everyMs])

  return { conversations, unread, loaded, refresh }
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
      {conversations.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`cch-item${c.unread > 0 ? ' unread' : ''}${c.id === activeId ? ' active' : ''}`}
          onClick={() => onPick(c.id)}
        >
          <div className="cch-item-top">
            <span>{c.visitorName || c.visitorEmail || 'Visitor'}</span>
            <time dateTime={c.lastMessageAt}>{new Date(c.lastMessageAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
          <div className="cch-item-preview">{c.preview ?? ''}</div>
        </button>
      ))}
    </div>
  )
}

export function AgentThread({ id, canReply, canManage, onBack, onChanged, compact }: {
  id: string
  canReply: boolean
  canManage?: boolean
  onBack?: () => void
  onChanged?: () => void
  compact?: boolean
}) {
  const [conversation, setConversation] = useState<ClientConversation | null>(null)
  const [messages, setMessages] = useState<ClientMessage[]>([])
  const [error, setError] = useState('')
  const lastId = useRef(0)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/conversations/${id}?after=${lastId.current}${document.hidden ? '' : '&read=1'}`, { cache: 'no-store' })
      if (res.status === 404) { setError('This chat has been deleted.'); return }
      if (!res.ok) return
      const json = (await res.json()) as { conversation: ClientConversation; messages: ClientMessage[] }
      setConversation(json.conversation)
      if (json.messages.length > 0) {
        lastId.current = json.messages[json.messages.length - 1]?.id ?? lastId.current
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id))
          return [...prev, ...json.messages.filter((m) => !known.has(m.id))]
        })
      }
    } catch { /* next round */ }
  }, [id])

  useEffect(() => {
    lastId.current = 0
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a different chat starts from nothing
    setMessages([])
    setConversation(null)
    setError('')
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await poll()
      timer = setTimeout(tick, document.hidden ? 20_000 : 3_000)
    }
    void tick()
    return () => clearTimeout(timer)
  }, [poll])

  async function send(body: string, files: File[]): Promise<boolean> {
    const res = await fetch(`${API_BASE}/admin/conversations/${id}/messages`, messageRequest({ body }, files))
    if (!res.ok) throw new Error(await readError(res))
    const json = (await res.json()) as { message: ClientMessage }
    setMessages((prev) => (prev.some((m) => m.id === json.message.id) ? prev : [...prev, json.message]))
    lastId.current = Math.max(lastId.current, json.message.id)
    onChanged?.()
    return true
  }

  async function endChat() {
    setError('')
    const res = await fetch(`${API_BASE}/admin/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    })
    if (!res.ok) { setError(await readError(res)); return }
    await poll()
    onChanged?.()
  }

  async function remove() {
    if (!window.confirm('Delete this chat and its files for good? There is no undo.')) return
    const res = await fetch(`${API_BASE}/admin/conversations/${id}`, { method: 'DELETE' })
    if (!res.ok) { setError(await readError(res)); return }
    onChanged?.()
    onBack?.()
  }

  const who = conversation?.visitorName || conversation?.visitorEmail || 'Visitor'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="cch-head" style={compact ? undefined : { background: 'var(--color-surface)', color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>
        {onBack ? <button type="button" aria-label="Back to chats" onClick={onBack}>←</button> : null}
        <h2 title={who}>{who}</h2>
        {conversation && canReply && conversation.status === 'open' ? <button type="button" onClick={endChat}>End chat</button> : null}
        {canManage && !compact ? <button type="button" onClick={remove}>Delete</button> : null}
      </div>
      {conversation && !compact ? (
        <div className="cch-muted" style={{ padding: '6px 14px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          {conversation.visitorEmail ? <>{conversation.visitorEmail} · </> : null}
          {conversation.pageUrl ? <>started on <a href={conversation.pageUrl} target="_blank" rel="noopener noreferrer">{conversation.pageUrl}</a> · </> : null}
          {conversation.notifications ? 'notifications on' : 'notifications off'}
        </div>
      ) : null}
      {error ? <div className="cch-error" role="alert" style={{ padding: '6px 14px' }}>{error}</div> : null}
      <MessageList messages={messages} mine="agent" />
      {canReply && conversation ? (
        conversation.status === 'closed'
          ? <div className="cch-muted" style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)' }}>This chat has ended, so no more messages can be sent.</div>
          : <Composer onSend={send} placeholder="Reply…" />
      ) : null}
    </div>
  )
}
