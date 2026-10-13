'use client'

import { useState } from 'react'
import { ChatStyles } from './ui'
import { AgentThread, ConversationList, useChatList } from './AgentThread'
import { AvailabilitySwitch, useAvailability } from './AvailabilitySwitch'
import { useVisitors, VisitorList, VisitorPanel } from './Visitors'
import type { ClientListedVisitor } from '@/modules/chat/lib/serialise'

// The Live chat tab of the admin Inbox: chats down the side, the chosen one
// beside them. Everything refreshes on its own every few seconds. "On the site"
// lists everybody browsing who agreed to the Live chat cookies, so we can see
// where they are and what is in their basket, and say hello first.

export function AdminInbox({ canReply, canManage, initialId }: { canReply: boolean; canManage: boolean; initialId: string | null }) {
  const [tab, setTab] = useState<'open' | 'closed' | 'visitors'>('open')
  const status = tab === 'closed' ? 'closed' : 'open'
  const [active, setActive] = useState<string | null>(initialId)
  const [visitor, setVisitor] = useState<ClientListedVisitor | null>(null)
  const { conversations, unread, loaded, refresh } = useChatList(status, 5_000)
  const visitors = useVisitors(tab === 'visitors', 5_000)

  function openChat(id: string) {
    setVisitor(null)
    setActive(id)
    setTab('open')
    void refresh()
  }
  const availability = useAvailability()

  return (
    <div className="cch-root" style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', height: 'calc(100vh - 220px)', minHeight: 420, background: 'var(--color-surface)' }}>
      <ChatStyles />
      <div style={{ width: 300, maxWidth: '40%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)' }}>
        <div className="cch-row" style={{ padding: 10, borderBottom: '1px solid var(--color-border)' }} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'open'} className={`cch-btn${tab === 'open' ? ' primary' : ''}`} onClick={() => setTab('open')}>
            Open{unread > 0 ? ` (${unread})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'closed'} className={`cch-btn${tab === 'closed' ? ' primary' : ''}`} onClick={() => setTab('closed')}>
            Ended
          </button>
          <button type="button" role="tab" aria-selected={tab === 'visitors'} className={`cch-btn${tab === 'visitors' ? ' primary' : ''}`} onClick={() => setTab('visitors')}>
            On the site{visitors.loaded && !visitors.reason ? ` (${visitors.visitors.length})` : ''}
          </button>
          {canReply ? <span style={{ marginLeft: 'auto' }}><AvailabilitySwitch online={availability.online} busy={availability.busy} onChange={availability.change} /></span> : null}
        </div>
        {tab === 'visitors' ? (
          <VisitorList visitors={visitors.visitors} reason={visitors.reason} loaded={visitors.loaded} activeId={visitor?.id} onPick={(v) => { setActive(null); setVisitor(v) }} />
        ) : loaded ? (
          <ConversationList
            conversations={conversations}
            activeId={active}
            onPick={(id) => { setVisitor(null); setActive(id) }}
            empty={status === 'open' ? 'No open chats. Enjoy the peace while it lasts.' : 'No ended chats yet.'}
          />
        ) : <p className="cch-muted" style={{ padding: 14 }}>Loading…</p>}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--color-bg-subtle)' }}>
        {visitor ? (
          <VisitorPanel key={visitor.id} visitor={visitor} canReply={canReply} onBack={() => setVisitor(null)} onChat={(id) => { void visitors.refresh(); openChat(id) }} />
        ) : active ? (
          <AgentThread key={active} id={active} canReply={canReply} canManage={canManage} onChanged={refresh} onBack={() => setActive(null)} />
        ) : (
          <p className="cch-muted" style={{ margin: 'auto' }}>{tab === 'visitors' ? 'Pick a visitor to see where they have been.' : 'Pick a chat to read it.'}</p>
        )}
      </div>
    </div>
  )
}
