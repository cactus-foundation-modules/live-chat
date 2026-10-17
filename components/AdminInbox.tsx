'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChatStyles } from './ui'
import { AgentThread, ConversationList, useChatList, visitorName } from './AgentThread'
import { AvailabilitySwitch, useAvailability } from './AvailabilitySwitch'
import { useVisitors, visitorLabel, VisitorList, VisitorPanel } from './Visitors'
import type { ClientConversation, ClientListedVisitor } from '@/modules/chat/lib/serialise'

// The Live chat tab of the admin Inbox: chats down the side, the chosen one
// beside them (one at a time on a phone). Everything keeps itself current -
// the list, the open chat, who is on the site, the Online switch - without a
// reload, and looks again the moment the tab comes back into view. "On the
// site" lists everybody browsing who agreed to the Live chat cookies, so we can
// see where they are and what is in their basket, and say hello first.

type Tab = 'open' | 'closed' | 'visitors'

function matches(query: string, ...fields: Array<string | null | undefined>): boolean {
  return fields.some((f) => f?.toLowerCase().includes(query))
}

/** The tab's title carries the waiting count, so a chat waiting in a tab at the
 *  back is visible from the tab strip. Put back as it was when the inbox goes. */
function useTitleCount(unread: number) {
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '')
    document.title = unread > 0 ? `(${unread}) ${base}` : base
  }, [unread])
  useEffect(() => () => { document.title = document.title.replace(/^\(\d+\) /, '') }, [])
}

export function AdminInbox({ canReply, canManage, initialId, initialTab = 'open' }: { canReply: boolean; canManage: boolean; initialId: string | null; initialTab?: 'open' | 'visitors' }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [active, setActive] = useState<string | null>(initialId)
  const [visitor, setVisitor] = useState<ClientListedVisitor | null>(null)
  const [query, setQuery] = useState('')
  const open = useChatList('open', 5_000, { quietId: active })
  const closed = useChatList('closed', 10_000, { enabled: tab === 'closed' })
  // Always about, a little slower when the tab is not on screen, so its count
  // in the tab is right before anybody clicks it.
  const visitors = useVisitors(true, tab === 'visitors' ? 5_000 : 15_000)
  const availability = useAvailability()
  useTitleCount(open.unread)

  // The address follows the chat on screen, so a reload or a shared link lands
  // on it again.
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (active) url.searchParams.set('id', active)
      else url.searchParams.delete('id')
      url.searchParams.delete('visitors')
      window.history.replaceState(window.history.state, '', url)
    } catch { /* the address just stays as it was */ }
  }, [active])

  function pick(id: string) {
    setVisitor(null)
    setActive(id)
  }

  function openChat(id: string) {
    pick(id)
    setTab('open')
  }

  function onConversation(c: ClientConversation) {
    open.patch(c)
    closed.patch(c)
  }

  function onDeleted(id: string) {
    open.remove(id)
    closed.remove(id)
  }

  const q = query.trim().toLowerCase()
  const list = tab === 'closed' ? closed : open
  const shownChats = useMemo(
    () => (q ? list.conversations.filter((c) => matches(q, c.visitorName, c.visitorEmail, c.preview, c.pageUrl)) : list.conversations),
    [list.conversations, q],
  )
  const shownVisitors = useMemo(
    () => (q ? visitors.visitors.filter((v) => matches(q, visitorLabel(v), v.currentTitle, v.currentPath)) : visitors.visitors),
    [visitors.visitors, q],
  )
  const othersWaiting = open.conversations.filter((c) => c.unread > 0 && c.id !== active).length
  const showing = visitor ? 'visitor' : active ? 'chat' : null
  const firstWaiting = open.conversations.find((c) => c.unread > 0)

  return (
    <div className="cch-root cch-inbox" data-pane={showing ? 'main' : 'side'}>
      <ChatStyles />
      <div className="cch-inbox-side">
        <div className="cch-inbox-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'open'} className={`cch-btn${tab === 'open' ? ' primary' : ''}`} onClick={() => setTab('open')}>
            Open{open.unread > 0 ? ` (${open.unread})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'closed'} className={`cch-btn${tab === 'closed' ? ' primary' : ''}`} onClick={() => setTab('closed')}>
            Ended
          </button>
          <button type="button" role="tab" aria-selected={tab === 'visitors'} className={`cch-btn${tab === 'visitors' ? ' primary' : ''}`} onClick={() => setTab('visitors')}>
            On the site{visitors.loaded && !visitors.reason ? ` (${visitors.visitors.length})` : ''}
          </button>
          {canReply ? <span style={{ marginLeft: 'auto' }}><AvailabilitySwitch online={availability.online} busy={availability.busy} onChange={availability.change} /></span> : null}
        </div>
        <input
          className="cch-input cch-search"
          type="search"
          placeholder={tab === 'visitors' ? 'Find a visitor or page' : 'Find a chat'}
          aria-label={tab === 'visitors' ? 'Find a visitor or page' : 'Find a chat'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={{ height: 8, flex: 'none' }} />
        {tab === 'visitors' ? (
          <VisitorList visitors={shownVisitors} reason={visitors.reason} loaded={visitors.loaded} activeId={visitor?.id} onPick={(v) => { setActive(null); setVisitor(v) }} />
        ) : list.loaded ? (
          <ConversationList
            conversations={shownChats}
            activeId={active}
            onPick={pick}
            empty={q ? 'Nothing matches that.' : tab === 'open' ? 'No open chats. Enjoy the peace while it lasts.' : 'No ended chats yet.'}
          />
        ) : <p className="cch-muted" style={{ padding: 14 }}>Loading…</p>}
      </div>
      <div className="cch-inbox-main">
        {visitor ? (
          <VisitorPanel key={visitor.id} visitor={visitor} canReply={canReply} onBack={() => setVisitor(null)} onChat={openChat} />
        ) : active ? (
          <AgentThread
            key={active}
            id={active}
            canReply={canReply}
            canManage={canManage}
            onConversation={onConversation}
            onDeleted={onDeleted}
            othersWaiting={othersWaiting}
            onBack={() => setActive(null)}
          />
        ) : (
          <div className="cch-inbox-empty cch-muted">
            {tab === 'visitors'
              ? 'Pick a visitor to see where they have been.'
              : firstWaiting
                ? (
                  <>
                    <p style={{ margin: '0 0 10px' }}>{open.unread} chat{open.unread === 1 ? ' is' : 's are'} waiting for a reply.</p>
                    <button type="button" className="cch-btn primary" onClick={() => openChat(firstWaiting.id)}>Open {visitorName(firstWaiting)}</button>
                  </>
                )
                : 'Pick a chat to read it.'}
          </div>
        )}
      </div>
    </div>
  )
}
