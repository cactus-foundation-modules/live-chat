'use client'

import { useEffect, useRef, useState } from 'react'
import { CHAT_OPEN_EVENT } from '@/modules/chat/lib/constants'
import { publishUnread } from '@/modules/chat/lib/unread'
import type { ClientConversation, ClientListedVisitor } from '@/modules/chat/lib/serialise'
import { BodyPortal, ChatStyles } from './ui'
import { AgentThread, ConversationList, useChatList, visitorName } from './AgentThread'
import { AvailabilitySwitch, useAvailability } from './AvailabilitySwitch'
import { NameOverrideButton } from './NameOverride'
import { useVisitors, VisitorList, VisitorPanel } from './Visitors'

// What a colleague signed in to the admin sees on the public site instead of
// the visitor's widget: the waiting chats, answerable without leaving the page.
// While it is shut, a new message pops up above the bubble the same way a
// reply does for a visitor. Its second tab lists everybody on the site who
// agreed to the Live chat cookies, chatting or not, so we can say hello first.

type Peek = { id: string; who: string; text: string }

export function AgentBubble({ position, canReply, hideOnMobile }: { position: 'left' | 'right'; canReply: boolean; hideOnMobile: boolean }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [tab, setTab] = useState<'chats' | 'visitors'>('chats')
  const [visitor, setVisitor] = useState<ClientListedVisitor | null>(null)
  const [peeks, setPeeks] = useState<Peek[]>([])
  const chats = useChatList('open', open ? 4_000 : 10_000, { quietId: open ? active : null })
  const { conversations, unread } = chats
  const lastSeen = useRef<Map<string, string> | null>(null)
  const availability = useAvailability()
  const visitors = useVisitors(open, tab === 'visitors' ? 5_000 : 15_000)

  useEffect(() => { publishUnread(unread) }, [unread])

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(CHAT_OPEN_EVENT, show)
    return () => window.removeEventListener(CHAT_OPEN_EVENT, show)
  }, [])

  // A chat whose newest message changed and is waiting on us is news.
  useEffect(() => {
    const now = new Map(conversations.map((c) => [c.id, c.lastMessageAt]))
    const before = lastSeen.current
    lastSeen.current = now
    if (!before || open) return
    const fresh: Peek[] = conversations
      .filter((c: ClientConversation) => c.unread > 0 && before.get(c.id) !== c.lastMessageAt)
      .map((c) => ({ id: c.id, who: visitorName(c), text: c.preview ?? '' }))
    if (fresh.length > 0) setPeeks((prev) => [...prev.filter((p) => !fresh.some((f) => f.id === p.id)), ...fresh].slice(-3))
  }, [conversations, open])

  // A peek whose chat has since been read (here, in the inbox, by a colleague)
  // is no longer news.
  const livePeeks = peeks.filter((p) => conversations.some((c) => c.id === p.id && c.unread > 0))
  const othersWaiting = conversations.filter((c) => c.unread > 0 && c.id !== active).length

  function openChat(id: string | null) {
    setActive(id)
    setVisitor(null)
    if (id) setTab('chats')
    setPeeks([])
    setOpen(true)
  }

  return (
    <BodyPortal>
    <div className="cch-root">
      <ChatStyles />
      <div className={`cch-dock ${position}${hideOnMobile ? ' cch-no-launcher-mobile' : ''}`}>
        {open ? (
          <section className="cch-panel" aria-label="Live chats">
            {active ? (
              <AgentThread
                key={active}
                id={active}
                canReply={canReply}
                compact
                othersWaiting={othersWaiting}
                onConversation={chats.patch}
                onDeleted={chats.remove}
                onBack={() => setActive(null)}
              />
            ) : visitor ? (
              <VisitorPanel
                key={visitor.id}
                visitor={visitor}
                canReply={canReply}
                compact
                onBack={() => setVisitor(null)}
                onChat={(id) => openChat(id)}
              />
            ) : (
              <>
                <header className="cch-head">
                  <h2>Live chats{unread > 0 ? ` (${unread} waiting)` : ''}</h2>
                  {canReply ? <AvailabilitySwitch onDark online={availability.online} busy={availability.busy} onChange={availability.change} /> : null}
                  {canReply ? <NameOverrideButton /> : null}
                  <button type="button" aria-label="Minimise" onClick={() => setOpen(false)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                </header>
                <div className="cch-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={tab === 'chats'} className={`cch-btn${tab === 'chats' ? ' primary' : ''}`} onClick={() => setTab('chats')}>
                    Chats{unread > 0 ? ` (${unread})` : ''}
                  </button>
                  <button type="button" role="tab" aria-selected={tab === 'visitors'} className={`cch-btn${tab === 'visitors' ? ' primary' : ''}`} onClick={() => setTab('visitors')}>
                    On the site{visitors.loaded && !visitors.reason ? ` (${visitors.visitors.length})` : ''}
                  </button>
                </div>
                {tab === 'chats'
                  ? <ConversationList conversations={conversations} activeId={active} onPick={(id) => setActive(id)} empty="No open chats. Suspiciously quiet." />
                  : <VisitorList visitors={visitors.visitors} reason={visitors.reason} loaded={visitors.loaded} onPick={setVisitor} />}
              </>
            )}
            {active || visitor ? (
              <div style={{ borderTop: '1px solid var(--color-border)', padding: 6, textAlign: 'right', background: 'var(--color-surface)' }}>
                <button type="button" className="cch-btn" onClick={() => setOpen(false)}>Minimise</button>
              </div>
            ) : null}
          </section>
        ) : (
          <>
            {livePeeks.length > 0 ? (
              <div className="cch-peeks">
                {livePeeks.map((p) => (
                  <div key={p.id} style={{ position: 'relative' }}>
                    <button type="button" className="cch-peek" onClick={() => openChat(p.id)}>
                      <strong>{p.who}</strong>
                      <span>{p.text}</span>
                    </button>
                    <button type="button" className="cch-peek-x" aria-label="Dismiss" onClick={() => setPeeks(peeks.filter((x) => x.id !== p.id))}>×</button>
                  </div>
                ))}
              </div>
            ) : null}
            <button type="button" className="cch-launcher" onClick={() => openChat(null)} aria-label={unread > 0 ? `Live chats (${unread} waiting)` : 'Live chats'}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              <span>{availability.online === false ? 'Chats (offline)' : 'Chats'}</span>
              {unread > 0 ? <span className="cch-badge">{unread}</span> : null}
            </button>
          </>
        )}
      </div>
    </div>
    </BodyPortal>
  )
}
